"""Gmail Bridge orchestration into the shared capture ingress, plus the
background poller.

The service reads the Google connector's shared token (``google-oauth.json``,
see :mod:`bridge.google`) — one sign-in covers Calendar and Gmail. Sync
bookkeeping lives in ``gmail-sync.json``. Polling always re-lists a bounded
window (``in:inbox newer_than:<days>d``), so the file is an efficiency/status
layer only: correctness comes from capture-ingress idempotency on each
message's ``external_id`` (``gmail:<messageId>``), and re-listing the window
can never duplicate a filed capture.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypedDict

from agents.sanitize import scrub_untrusted
from bridge.gmail import GmailAuthError, GmailClient, GmailError
from bridge.google import load_google_tokens, save_google_tokens
from core.capture_ingress import ingest_capture
from core.config import GlobalConfig, settings

if TYPE_CHECKING:
    from core.vault import VaultManager

logger = logging.getLogger(__name__)

_MAX_MESSAGES_PER_POLL = 100


class GmailSyncConflictError(RuntimeError):
    """Raised when the active vault changes during a Gmail synchronization."""


class GmailSyncResult(TypedDict):
    synced_at: str
    fetched: int
    created: int
    deduplicated: int
    errors: int
    capture_ids: list[str]


def _cursor_path() -> Path:
    return Path(settings.config_path).parent / "gmail-sync.json"


def _load_cursor() -> dict[str, str]:
    try:
        data = json.loads(_cursor_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    mailbox = data.get("mailbox")
    if not isinstance(mailbox, dict):
        return {}
    return {k: str(v) for k, v in mailbox.items() if isinstance(v, str)}


def _save_cursor(fields: dict[str, str]) -> None:
    path = _cursor_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"mailbox": fields}, indent=2), encoding="utf-8")
    tmp.replace(path)


def clear_gmail_cursors() -> None:
    """Wipe sync bookkeeping (disconnect / fresh re-connect)."""
    try:
        _save_cursor({})
    except OSError:
        logger.warning("Could not clear Gmail sync state", exc_info=True)


async def sync_gmail(
    *,
    vm: VaultManager | None = None,
    client: GmailClient | None = None,
) -> GmailSyncResult:
    """Poll the mailbox window once and ingest new mail as Inbox captures.

    One message's fetch/parse failure does not abort the rest — it is counted
    and the loop moves on. A revoked grant fails the whole sync up front with
    a clear reconnect error instead.
    """
    if vm is None:
        from core.vault import get_vault_manager

        vm = get_vault_manager()
    vault_root = vm.active_vault_dir().resolve()
    if not vault_root.exists() or not (vault_root / "vault.yaml").exists():
        raise GmailSyncConflictError("No active vault is available for Gmail sync")

    config = GlobalConfig.load(vm.config_path())
    connector = config.google
    gmail = connector.gmail
    if not connector.client_id or not connector.client_secret:
        raise GmailError("Add your Google OAuth client ID and secret first")
    tokens = load_google_tokens()
    if tokens is None:
        raise GmailError("Connect your Google account first")

    owns_client = client is None
    client = client or GmailClient(
        client_id=connector.client_id,
        client_secret=str(connector.client_secret),
        tokens=tokens,
        on_tokens=save_google_tokens,
    )
    fetched = 0
    created = 0
    deduplicated = 0
    errors = 0
    capture_ids: list[str] = []
    try:
        # Fail fast with a clear reconnect message when the grant is revoked,
        # rather than recording the same auth failure on every message.
        await client.ensure_fresh_token()
        ids = await client.list_message_ids(
            query=f"in:inbox newer_than:{gmail.lookback_days}d",
            max_messages=_MAX_MESSAGES_PER_POLL,
        )
        for message_id in ids:
            if vm.active_vault_dir().resolve() != vault_root:
                raise GmailSyncConflictError("The active vault changed; retry Gmail sync")
            try:
                item = await client.fetch_message(message_id)
            except GmailAuthError:
                raise
            except Exception:  # one bad message must not sink the sync
                logger.warning("Gmail fetch failed for %s", message_id, exc_info=True)
                errors += 1
                continue
            if item is None:
                continue
            fetched += 1
            ingested = await ingest_capture(
                vault_root,
                title=scrub_untrusted(item.subject) or "(no subject)",
                body=scrub_untrusted(item.to_capture_markdown()),
                source="bridge:gmail",
                tags=("email",),
                external_id=item.external_id,
                provenance=item.provenance(),
            )
            created += int(ingested.created)
            deduplicated += int(ingested.deduplicated)
            capture_ids.append(ingested.capture.id)
        cursor = _load_cursor()
        cursor["synced_at"] = datetime.now(UTC).isoformat()
        try:
            _save_cursor(cursor)
        except OSError:
            logger.warning("Could not persist Gmail sync state", exc_info=True)
    finally:
        if owns_client:
            await client.aclose()

    if vm.active_vault_dir().resolve() != vault_root:
        raise GmailSyncConflictError("The active vault changed; retry Gmail sync")
    return {
        "synced_at": datetime.now(UTC).isoformat(),
        "fetched": fetched,
        "created": created,
        "deduplicated": deduplicated,
        "errors": errors,
        "capture_ids": capture_ids,
    }


# ---------------------------------------------------------------------------
# Background poller
# ---------------------------------------------------------------------------


class GmailSyncService:
    """Interval poller for :func:`sync_gmail` — mirrors the other bridge
    pollers. Config is re-read every tick; :meth:`notify` wakes the loop
    early after a settings save or a completed OAuth connect."""

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()
        self._last_run: str = ""
        self._last_error: str = ""
        self._last_created: int = 0

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="gmail-sync")

    async def aclose(self) -> None:
        self._stop.set()
        self._wake.set()
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    def notify(self) -> None:
        """Wake the loop immediately (e.g. after a settings save)."""
        self._wake.set()

    def status(self) -> dict[str, Any]:
        """Last-run state for the bridge status endpoint."""
        return {
            "running": self._task is not None and not self._task.done(),
            "last_run": self._last_run,
            "last_error": self._last_error,
            "last_created": self._last_created,
        }

    async def _loop(self) -> None:
        while not self._stop.is_set():
            config = GlobalConfig.load(settings.config_path)
            connector = config.google
            gmail = connector.gmail
            interval_s = max(5, gmail.interval_minutes) * 60
            if (
                gmail.enabled
                and connector.client_id
                and connector.client_secret
                and load_google_tokens()
            ):
                try:
                    result = await sync_gmail()
                    self._last_run = result["synced_at"]
                    self._last_created = result["created"]
                    self._last_error = (
                        f"{result['errors']} message(s) failed" if result["errors"] else ""
                    )
                except Exception as exc:
                    logger.warning("Gmail sync tick failed", exc_info=True)
                    self._last_run = datetime.now(UTC).isoformat()
                    self._last_error = str(exc)
            self._wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=interval_s)


_service: GmailSyncService | None = None


def get_gmail_sync_service() -> GmailSyncService:
    """Return the process-wide Gmail sync poller."""
    global _service
    if _service is None:
        _service = GmailSyncService()
    return _service

"""Email Bridge orchestration into the shared capture ingress, plus the
background poller.

Cursor state (last seen IMAP UID) lives in ``email-sync.json`` next to
``config.yaml``. Like the GitHub bridge, the cursor is an *efficiency*
layer only — correctness comes from capture-ingress idempotency on each
message's ``external_id``, so a lost cursor can re-list mail but never
duplicate a filed capture.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypedDict

from bridge.email import EmailClient, EmailError
from core.capture_ingress import ingest_capture
from core.config import GlobalConfig, settings

if TYPE_CHECKING:
    from core.vault import VaultManager

logger = logging.getLogger(__name__)


class EmailSyncConflictError(RuntimeError):
    """Raised when the active vault changes during an email synchronization."""


class EmailSyncResult(TypedDict):
    synced_at: str
    folder: str
    fetched: int
    created: int
    deduplicated: int
    capture_ids: list[str]


def _cursor_path() -> Path:
    return Path(settings.config_path).parent / "email-sync.json"


def _load_cursor() -> int:
    try:
        data = json.loads(_cursor_path().read_text(encoding="utf-8"))
        return int(data.get("last_uid") or 0)
    except (OSError, ValueError, TypeError):
        return 0


def _save_cursor(last_uid: int) -> None:
    path = _cursor_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"last_uid": last_uid}), encoding="utf-8")
    tmp.replace(path)


async def sync_email(
    *,
    vm: VaultManager | None = None,
    client: EmailClient | None = None,
) -> EmailSyncResult:
    """Poll the configured mailbox once and ingest new mail as Inbox captures."""
    if vm is None:
        from core.vault import get_vault_manager

        vm = get_vault_manager()
    vault_root = vm.active_vault_dir().resolve()
    if not vault_root.exists() or not (vault_root / "vault.yaml").exists():
        raise EmailSyncConflictError("No active vault is available for email sync")

    config = GlobalConfig.load(vm.config_path())
    mail = config.email
    if not mail.host or not mail.username or not mail.password:
        raise EmailError("Configure the IMAP host, username, and password first")

    cursor = _load_cursor()
    lookback_start = datetime.now(UTC) - timedelta(hours=mail.lookback_hours)

    # Injected or constructed, the client's async context manager owns logout.
    client = client or EmailClient(
        mail.host, mail.port, mail.username, mail.password, use_ssl=mail.use_ssl
    )
    fetched = 0
    created = 0
    deduplicated = 0
    capture_ids: list[str] = []
    max_uid = cursor
    try:
        async with client:
            items = await client.fetch_since(
                mail.folder,
                since_uid=cursor,
                lookback_start=lookback_start,
                limit=mail.max_messages_per_poll,
            )
            for item in items:
                if vm.active_vault_dir().resolve() != vault_root:
                    raise EmailSyncConflictError("The active vault changed; retry email sync")
                fetched += 1
                max_uid = max(max_uid, item.uid)
                ingested = await ingest_capture(
                    vault_root,
                    title=item.subject or "(no subject)",
                    body=item.to_capture_markdown(),
                    source="bridge:email",
                    tags=("email",),
                    external_id=item.external_id,
                    provenance=item.provenance(),
                )
                created += int(ingested.created)
                deduplicated += int(ingested.deduplicated)
                capture_ids.append(ingested.capture.id)
    finally:
        # Advance the cursor even on a partial sync — ingress dedup makes
        # re-fetching safe, and a poison message must not stall the mailbox.
        if max_uid > cursor:
            try:
                _save_cursor(max_uid)
            except OSError:
                logger.warning("Could not persist email sync cursor", exc_info=True)

    if vm.active_vault_dir().resolve() != vault_root:
        raise EmailSyncConflictError("The active vault changed; retry email sync")
    return {
        "synced_at": datetime.now(UTC).isoformat(),
        "folder": mail.folder,
        "fetched": fetched,
        "created": created,
        "deduplicated": deduplicated,
        "capture_ids": capture_ids,
    }


# ---------------------------------------------------------------------------
# Background poller
# ---------------------------------------------------------------------------


class EmailSyncService:
    """Interval poller for :func:`sync_email` — mirrors the GitHub poller.

    Config is re-read every tick; :meth:`notify` wakes the loop early after a
    settings save.
    """

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
        self._task = asyncio.create_task(self._loop(), name="email-sync")

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
        """Last-run state for the automations status endpoint."""
        return {
            "running": self._task is not None and not self._task.done(),
            "last_run": self._last_run,
            "last_error": self._last_error,
            "last_created": self._last_created,
        }

    async def _loop(self) -> None:
        while not self._stop.is_set():
            config = GlobalConfig.load(settings.config_path)
            interval_s = max(5, config.email.interval_minutes) * 60
            mail = config.email
            if mail.enabled and mail.host and mail.username and mail.password:
                try:
                    result = await sync_email()
                    self._last_run = result["synced_at"]
                    self._last_created = result["created"]
                    self._last_error = ""
                except Exception as exc:
                    logger.warning("Email sync tick failed", exc_info=True)
                    self._last_run = datetime.now(UTC).isoformat()
                    self._last_error = str(exc)
            self._wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=interval_s)


_service: EmailSyncService | None = None


def get_email_sync_service() -> EmailSyncService:
    """Return the process-wide email sync poller."""
    global _service
    if _service is None:
        _service = EmailSyncService()
    return _service

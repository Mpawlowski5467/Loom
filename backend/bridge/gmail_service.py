"""Gmail Bridge orchestration into the shared capture ingress, plus the
background poller.

The service reads the Google connector's shared token (``google-oauth.json``,
see :mod:`bridge.google`); one sign-in covers Calendar and Gmail.

Sync uses Gmail's history API, the incremental sync Google recommends.
``gmail-sync.json`` holds the mailbox history position already read and a
queue of message IDs found but not yet imported, oldest first:

- The first sync records the history position *before* listing the look-back
  window (``in:inbox newer_than:<days>d``), so mail that arrives during the
  listing is caught by the next history read. The window is queued.
- Each poll queues inbox messages added since the saved position, then
  imports up to ``_MAX_MESSAGES_PER_POLL`` from the front of the queue. A
  backlog of any size drains across polls instead of being cut off.
- A message leaves the queue once it is handled: ingested, rejected by
  ingress validation, or gone from Gmail. A temporary failure moves it to the
  back of the queue for the next poll, so it is neither lost nor blocking.
- When the saved position is too old for Gmail (it keeps about a week), the
  mailbox is listed again back to the last sync; capture-ingress idempotency
  on ``gmail:<messageId>`` keeps re-listed mail from filing twice.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

# typing_extensions, not typing: Pydantic rejects typing.TypedDict as a
# response model on Python < 3.12, and these shapes are FastAPI response_models.
from typing_extensions import TypedDict

from agents.sanitize import scrub_untrusted
from bridge.gmail import (
    GmailAuthError,
    GmailClient,
    GmailError,
    GmailHistoryExpiredError,
    GmailNotFoundError,
)
from bridge.google import google_app, google_app_for, load_google_tokens, save_google_tokens
from core.capture_ingress import CaptureIngressError, ingest_capture
from core.config import GlobalConfig, settings

if TYPE_CHECKING:
    from core.vault import VaultManager

logger = logging.getLogger(__name__)

_MAX_MESSAGES_PER_POLL = 100
_MAX_PENDING = 10_000
# Stop a poll after this many fetch failures in a row: it is an outage, not
# one bad message, and every further attempt would fail the same way.
_MAX_CONSECUTIVE_FAILURES = 3
# While a backlog remains, poll again this soon instead of waiting the full
# interval, so a large backlog drains in minutes rather than hours.
_BACKLOG_POLL_SECONDS = 60
_MAX_CATCH_UP_DAYS = 365


class GmailSyncConflictError(RuntimeError):
    """Raised when the active vault changes during a Gmail synchronization."""


class GmailSyncResult(TypedDict):
    synced_at: str
    fetched: int
    created: int
    deduplicated: int
    errors: int
    capture_ids: list[str]
    pending: int  # messages still queued for later polls


@dataclass
class _GmailCursor:
    history_id: str = ""
    pending: list[str] = field(default_factory=list)
    synced_at: str = ""


def _cursor_path() -> Path:
    return Path(settings.config_path).parent / "gmail-sync.json"


def _load_cursor() -> _GmailCursor:
    try:
        data = json.loads(_cursor_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _GmailCursor()
    mailbox = data.get("mailbox") if isinstance(data, dict) else None
    if not isinstance(mailbox, dict):
        return _GmailCursor()
    pending = mailbox.get("pending")
    return _GmailCursor(
        history_id=str(mailbox.get("history_id") or ""),
        pending=[str(i) for i in pending if isinstance(i, str) and i]
        if isinstance(pending, list)
        else [],
        synced_at=str(mailbox.get("synced_at") or ""),
    )


def _write_cursor_file(mailbox: dict[str, Any]) -> None:
    path = _cursor_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"mailbox": mailbox}, indent=2), encoding="utf-8")
    tmp.replace(path)


def _save_cursor(cursor: _GmailCursor) -> None:
    _write_cursor_file(
        {
            "history_id": cursor.history_id,
            "pending": cursor.pending,
            "synced_at": cursor.synced_at,
        }
    )


def clear_gmail_cursors() -> None:
    """Wipe sync bookkeeping (disconnect / fresh re-connect)."""
    try:
        _write_cursor_file({})
    except OSError:
        logger.warning("Could not clear Gmail sync state", exc_info=True)


def _enqueue(queue: list[str], new_ids: Iterable[str]) -> None:
    """Append IDs not already queued, keeping order; bound the queue."""
    known = set(queue)
    for message_id in new_ids:
        if message_id not in known:
            known.add(message_id)
            queue.append(message_id)
    if len(queue) > _MAX_PENDING:
        dropped = len(queue) - _MAX_PENDING
        logger.warning(
            "Gmail import queue exceeds %d messages; dropping the %d oldest",
            _MAX_PENDING,
            dropped,
        )
        del queue[:dropped]


def _days_since(iso_time: str) -> int:
    try:
        then = datetime.fromisoformat(iso_time)
    except ValueError:
        return 0
    elapsed = (datetime.now(UTC) - then).total_seconds() / 86_400
    return max(0, math.ceil(elapsed))


async def _discover(
    client: GmailClient, cursor: _GmailCursor, lookback_days: int
) -> tuple[list[str], str]:
    """New inbox message IDs (oldest first) and the history position after them."""
    days = lookback_days
    if cursor.history_id:
        try:
            return await client.list_history(cursor.history_id)
        except GmailHistoryExpiredError:
            # Catch up from the last successful sync, not just the look-back
            # window, so nothing received while Loom was off is skipped.
            days = min(_MAX_CATCH_UP_DAYS, max(lookback_days, _days_since(cursor.synced_at) + 1))
            logger.info("Gmail history expired; re-listing the last %d days", days)
    # Record the position first: mail arriving during the listing is then
    # returned by the next history read instead of falling between the two.
    history_id = await client.fetch_history_id()
    listed = await client.list_message_ids(
        query=f"in:inbox newer_than:{days}d", max_messages=_MAX_PENDING
    )
    return list(reversed(listed)), history_id  # listed newest first


async def sync_gmail(
    *,
    vm: VaultManager | None = None,
    client: GmailClient | None = None,
) -> GmailSyncResult:
    """Queue newly arrived inbox mail and import the oldest queued messages.

    A message that fails to fetch is retried on a later poll without blocking
    the rest. A revoked grant fails the whole sync up front with a clear
    reconnect error instead.
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
    if google_app(connector) is None:
        raise GmailError("Add your Google OAuth client ID and secret first")
    tokens = load_google_tokens()
    if tokens is None:
        raise GmailError("Connect your Google account first")
    app = google_app_for(connector, tokens)
    if app is None:
        raise GmailError("Reconnect Google: the app this account was connected with is gone")

    owns_client = client is None
    client = client or GmailClient(
        client_id=app.client_id,
        client_secret=app.client_secret,
        tokens=tokens,
        on_tokens=save_google_tokens,
    )
    fetched = 0
    created = 0
    deduplicated = 0
    errors = 0
    capture_ids: list[str] = []
    cursor = _load_cursor()
    try:
        # Fail fast with a clear reconnect message when the grant is revoked,
        # rather than recording the same auth failure on every message.
        await client.ensure_fresh_token()
        new_ids, history_id = await _discover(client, cursor, gmail.lookback_days)
        _enqueue(cursor.pending, new_ids)
        cursor.history_id = history_id
        cursor.synced_at = datetime.now(UTC).isoformat()
        queue = cursor.pending
        failures = 0
        try:
            for message_id in queue[:_MAX_MESSAGES_PER_POLL]:
                if vm.active_vault_dir().resolve() != vault_root:
                    raise GmailSyncConflictError("The active vault changed; retry Gmail sync")
                try:
                    item = await client.fetch_message(message_id)
                except GmailAuthError:
                    raise
                except GmailNotFoundError:
                    item = None  # deleted since it was listed: nothing to import
                except Exception:  # retry later without blocking the rest
                    logger.warning("Gmail fetch failed for %s", message_id, exc_info=True)
                    errors += 1
                    failures += 1
                    queue.remove(message_id)
                    queue.append(message_id)
                    if failures >= _MAX_CONSECUTIVE_FAILURES:
                        break
                    continue
                failures = 0
                if item is not None:
                    fetched += 1
                    try:
                        ingested = await ingest_capture(
                            vault_root,
                            title=scrub_untrusted(item.subject) or "(no subject)",
                            body=scrub_untrusted(item.to_capture_markdown()),
                            source="bridge:gmail",
                            tags=("email",),
                            external_id=item.external_id,
                            provenance=item.provenance(),
                        )
                    except CaptureIngressError:
                        logger.warning("Skipping Gmail message %s rejected by ingress", message_id)
                    else:
                        created += int(ingested.created)
                        deduplicated += int(ingested.deduplicated)
                        capture_ids.append(ingested.capture.id)
                queue.remove(message_id)
        finally:
            # The queue is the durable record: whatever was not handled stays
            # in it, including a message whose ingest just failed.
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
        "pending": len(cursor.pending),
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
            if gmail.enabled and google_app(connector) is not None and load_google_tokens():
                try:
                    result = await sync_gmail()
                    if result["pending"]:
                        interval_s = min(interval_s, _BACKLOG_POLL_SECONDS)
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

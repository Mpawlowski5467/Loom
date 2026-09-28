"""Email Bridge orchestration into the shared capture ingress, plus the
background poller.

Cursor state (the last handled IMAP UID, plus the mailbox and UIDVALIDITY
it belongs to) lives in ``email-sync.json`` next to ``config.yaml``. Like the GitHub bridge, the cursor is an *efficiency*
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
from typing import TYPE_CHECKING, Any

# typing_extensions, not typing: Pydantic rejects typing.TypedDict as a
# response model on Python < 3.12, and these shapes are FastAPI response_models.
from typing_extensions import TypedDict

from bridge.email import EmailClient, EmailError
from core.capture_ingress import CaptureIngressError, ingest_capture
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


def _mailbox_key(host: str, username: str, folder: str) -> str:
    """Identify the mailbox a UID cursor belongs to: UIDs are per folder."""
    return f"{username.lower()}@{host.lower()}/{folder}"


def _load_cursor(mailbox: str) -> tuple[int, str]:
    """Return ``(last_uid, uid_validity)`` for ``mailbox``.

    A cursor saved for another host, account, or folder is meaningless here,
    and following it could skip every message, so it reads as a fresh start.
    Cursors written before the mailbox was recorded are trusted as-is.
    """
    try:
        data = json.loads(_cursor_path().read_text(encoding="utf-8"))
        saved_for = data.get("mailbox")
        if saved_for is not None and saved_for != mailbox:
            return 0, ""
        return int(data.get("last_uid") or 0), str(data.get("uid_validity") or "")
    except (OSError, ValueError, TypeError, AttributeError):
        return 0, ""


def _save_cursor(mailbox: str, last_uid: int, uid_validity: str) -> None:
    path = _cursor_path()
    tmp = path.with_suffix(".tmp")
    payload = {"mailbox": mailbox, "last_uid": last_uid, "uid_validity": uid_validity}
    tmp.write_text(json.dumps(payload), encoding="utf-8")
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

    mailbox = _mailbox_key(mail.host, mail.username, mail.folder)
    cursor, uid_validity = _load_cursor(mailbox)
    lookback_start = datetime.now(UTC) - timedelta(hours=mail.lookback_hours)

    # Injected or constructed, the client's async context manager owns logout.
    client = client or EmailClient(
        mail.host, mail.port, mail.username, mail.password, use_ssl=mail.use_ssl
    )
    fetched = 0
    created = 0
    deduplicated = 0
    capture_ids: list[str] = []
    # The cursor only ever moves past messages that were handled: ingested,
    # or permanently rejected by ingress validation (so one bad message
    # cannot stall the mailbox). A transient failure stops the sync *before*
    # that message, and the next poll retries it.
    handled_uid = cursor
    fetched_ok = False
    try:
        async with client:
            items = await client.fetch_since(
                mail.folder,
                since_uid=cursor,
                uid_validity=uid_validity,
                lookback_start=lookback_start,
                limit=mail.max_messages_per_poll,
            )
            fetched_ok = True
            if client.uid_validity and client.uid_validity != uid_validity and uid_validity:
                handled_uid = 0  # folder renumbered: fetch_since restarted the walk
            for item in items:  # oldest first
                if vm.active_vault_dir().resolve() != vault_root:
                    raise EmailSyncConflictError("The active vault changed; retry email sync")
                fetched += 1
                try:
                    ingested = await ingest_capture(
                        vault_root,
                        title=item.subject or "(no subject)",
                        body=item.to_capture_markdown(),
                        source="bridge:email",
                        tags=("email",),
                        external_id=item.external_id,
                        provenance=item.provenance(),
                    )
                except CaptureIngressError:
                    logger.warning("Skipping email uid=%s rejected by ingress", item.uid)
                else:
                    created += int(ingested.created)
                    deduplicated += int(ingested.deduplicated)
                    capture_ids.append(ingested.capture.id)
                handled_uid = item.uid
    finally:
        new_validity = client.uid_validity or uid_validity
        if fetched_ok and (handled_uid, new_validity) != (cursor, uid_validity):
            try:
                _save_cursor(mailbox, handled_uid, new_validity)
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

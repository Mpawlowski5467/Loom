"""Outlook Calendar Bridge orchestration into the shared capture ingress, plus
the background poller.

OAuth tokens live, encrypted, in ``outlook-cal-oauth.json`` next to
``config.yaml`` (see :mod:`bridge.oauth`); per-calendar bookkeeping lives in
``outlook-cal-sync.json``. Polling always lists a bounded window
(``calendarView`` — no delta tokens), so the file is an efficiency/status
layer only: correctness comes from capture-ingress idempotency on each
event's ``external_id`` (``outlook-cal:<calendarId>:<eventId>``), and re-
listing a window can never duplicate a filed capture.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypedDict

from agents.sanitize import scrub_untrusted
from bridge.oauth import OAuthTokens, clear_tokens, load_tokens, save_tokens
from bridge.outlook_cal import OutlookCalendarClient, OutlookCalendarError
from core.capture_ingress import ingest_capture
from core.config import GlobalConfig, settings

if TYPE_CHECKING:
    from bridge.calendar import CalendarEvent
    from core.vault import VaultManager

logger = logging.getLogger(__name__)

_LOOKAHEAD_DAYS = 30


class OutlookCalendarSyncConflictError(RuntimeError):
    """Raised when the active vault changes during an Outlook Calendar sync."""


class OutlookCalendarSliceResult(TypedDict):
    calendar: str
    fetched: int
    created: int
    deduplicated: int
    error: str


class OutlookCalendarSyncResult(TypedDict):
    synced_at: str
    calendars: list[OutlookCalendarSliceResult]
    created: int
    deduplicated: int
    errors: int


def _tokens_path() -> Path:
    return Path(settings.config_path).parent / "outlook-cal-oauth.json"


def _cursor_path() -> Path:
    return Path(settings.config_path).parent / "outlook-cal-sync.json"


def _load_cursors() -> dict[str, dict[str, str]]:
    try:
        data = json.loads(_cursor_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    calendars = data.get("calendars")
    if not isinstance(calendars, dict):
        return {}
    return {
        str(calendar): {k: str(v) for k, v in fields.items() if isinstance(v, str)}
        for calendar, fields in calendars.items()
        if isinstance(fields, dict)
    }


def _save_cursors(cursors: dict[str, dict[str, str]]) -> None:
    path = _cursor_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"calendars": cursors}, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_outlook_tokens() -> OAuthTokens | None:
    """Return the stored Outlook OAuth tokens, if any are usable."""
    return load_tokens(_tokens_path())


def save_outlook_tokens(tokens: OAuthTokens) -> None:
    """Persist Outlook OAuth tokens encrypted at rest."""
    save_tokens(_tokens_path(), tokens)


def clear_outlook_connection() -> None:
    """Wipe tokens and sync bookkeeping (disconnect / fresh re-connect)."""
    clear_tokens(_tokens_path())
    try:
        _save_cursors({})
    except OSError:
        logger.warning("Could not clear Outlook Calendar sync cursors", exc_info=True)


def _external_id(calendar_id: str, event: CalendarEvent) -> str:
    return f"outlook-cal:{calendar_id}:{event.uid}"


async def sync_outlook_calendar(
    *,
    vm: VaultManager | None = None,
    client: OutlookCalendarClient | None = None,
) -> OutlookCalendarSyncResult:
    """Poll every configured calendar once and ingest events as Inbox captures.

    One calendar's failure does not abort the rest — it is recorded in that
    calendar's result slot and the loop moves on. A revoked grant fails the
    whole sync up front with a clear reconnect error instead.
    """
    if vm is None:
        from core.vault import get_vault_manager

        vm = get_vault_manager()
    vault_root = vm.active_vault_dir().resolve()
    if not vault_root.exists() or not (vault_root / "vault.yaml").exists():
        raise OutlookCalendarSyncConflictError("No active vault is available for calendar sync")

    config = GlobalConfig.load(vm.config_path())
    outlook = config.outlook_calendar
    if not outlook.client_id or not outlook.client_secret:
        raise OutlookCalendarError("Add your Microsoft app's client ID and secret first")
    tokens = load_outlook_tokens()
    if tokens is None:
        raise OutlookCalendarError("Connect your Outlook account first")

    owns_client = client is None
    client = client or OutlookCalendarClient(
        client_id=outlook.client_id,
        client_secret=str(outlook.client_secret),
        tokens=tokens,
        on_tokens=save_outlook_tokens,
    )
    cursors = _load_cursors()
    now = datetime.now(UTC)
    time_min = now - timedelta(days=outlook.lookback_days)
    time_max = now + timedelta(days=_LOOKAHEAD_DAYS)
    calendars = list(outlook.calendar_ids) or ["primary"]
    timezone = config.standup_schedule.timezone
    results: list[OutlookCalendarSliceResult] = []
    totals = {"created": 0, "deduplicated": 0, "errors": 0}
    try:
        # Fail fast with a clear reconnect message when the grant is revoked,
        # rather than recording the same auth failure on every calendar.
        await client.ensure_fresh_token()
        for calendar_id in calendars:
            if vm.active_vault_dir().resolve() != vault_root:
                raise OutlookCalendarSyncConflictError(
                    "The active vault changed; retry calendar sync"
                )
            result: OutlookCalendarSliceResult = {
                "calendar": calendar_id,
                "fetched": 0,
                "created": 0,
                "deduplicated": 0,
                "error": "",
            }
            results.append(result)
            try:
                events = await client.list_events(
                    calendar_id,
                    time_min=time_min,
                    time_max=time_max,
                    default_tz=timezone,
                )
                for event in events:
                    if vm.active_vault_dir().resolve() != vault_root:
                        raise OutlookCalendarSyncConflictError(
                            "The active vault changed; retry calendar sync"
                        )
                    result["fetched"] += 1
                    ingested = await ingest_capture(
                        vault_root,
                        title=scrub_untrusted(event.title) or "Untitled event",
                        body=event.to_capture_markdown(),
                        source="bridge:outlook-cal",
                        tags=("calendar", "meeting"),
                        external_id=_external_id(calendar_id, event),
                        provenance={
                            "provider": "outlook",
                            "calendar": calendar_id,
                            "event_uid": event.uid,
                            "start": event.start.isoformat(),
                            "end": event.end.isoformat(),
                            "all_day": event.all_day,
                            "location": event.location,
                            "event_url": event.url,
                        },
                    )
                    result["created"] += int(ingested.created)
                    result["deduplicated"] += int(ingested.deduplicated)
                cursor = dict(cursors.get(calendar_id, {}))
                cursor["synced_at"] = datetime.now(UTC).isoformat()
                cursors[calendar_id] = cursor
                try:
                    _save_cursors(cursors)
                except OSError:
                    logger.warning("Could not persist Outlook Calendar cursors", exc_info=True)
            except OutlookCalendarSyncConflictError:
                raise
            except Exception as exc:  # one calendar down must not sink the rest
                logger.warning("Outlook Calendar sync failed for %s", calendar_id, exc_info=True)
                result["error"] = str(exc)
                totals["errors"] += 1
            totals["created"] += result["created"]
            totals["deduplicated"] += result["deduplicated"]
    finally:
        if owns_client:
            await client.aclose()

    return {
        "synced_at": datetime.now(UTC).isoformat(),
        "calendars": results,
        "created": totals["created"],
        "deduplicated": totals["deduplicated"],
        "errors": totals["errors"],
    }


# ---------------------------------------------------------------------------
# Background poller
# ---------------------------------------------------------------------------


class OutlookCalendarSyncService:
    """Interval poller for :func:`sync_outlook_calendar` — mirrors the other
    bridge pollers. Config is re-read every tick; :meth:`notify` wakes the
    loop early after a settings save or a completed OAuth connect."""

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
        self._task = asyncio.create_task(self._loop(), name="outlook-cal-sync")

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
            outlook = config.outlook_calendar
            interval_s = max(5, outlook.interval_minutes) * 60
            if (
                outlook.enabled
                and outlook.client_id
                and outlook.client_secret
                and load_outlook_tokens()
            ):
                try:
                    result = await sync_outlook_calendar()
                    self._last_run = result["synced_at"]
                    self._last_created = result["created"]
                    self._last_error = (
                        f"{result['errors']} calendar(s) failed" if result["errors"] else ""
                    )
                except Exception as exc:
                    logger.warning("Outlook Calendar sync tick failed", exc_info=True)
                    self._last_run = datetime.now(UTC).isoformat()
                    self._last_error = str(exc)
            self._wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=interval_s)


_service: OutlookCalendarSyncService | None = None


def get_outlook_calendar_sync_service() -> OutlookCalendarSyncService:
    """Return the process-wide Outlook Calendar sync poller."""
    global _service
    if _service is None:
        _service = OutlookCalendarSyncService()
    return _service

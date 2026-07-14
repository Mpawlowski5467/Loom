"""Durable active-vault scheduler for the Standup Shuttle agent."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from core.config import GlobalConfig, StandupScheduleConfig
from core.events import STANDUP_SCHEDULE_CHANGED, get_event_hub

logger = logging.getLogger(__name__)

_CHECK_INTERVAL_SECONDS = 30.0
_MAX_DAILY_ATTEMPTS = 3
_RETRY_DELAY = timedelta(minutes=30)
_PRIVATE_URL_RE = re.compile(r"(?i)\b(?:https?|webcal)://[^\s<>'\"]+")
_SECRET_RE = re.compile(
    r"(?i)\b(api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]\s*[^\s,;]+"
)
_OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")


class StandupScheduleBusyError(RuntimeError):
    """Raised when a vault handoff collides with a scheduled Standup run."""


class StandupScheduleState(BaseModel):
    """Small per-vault durable execution ledger."""

    scheduled_date: str = Field(default="", max_length=10)
    attempts: int = Field(default=0, ge=0, le=1_000)
    last_attempt_at: str = Field(default="", max_length=64)
    last_success_date: str = Field(default="", max_length=10)
    last_success_at: str = Field(default="", max_length=64)
    last_error: str = Field(default="", max_length=500)
    last_capture_id: str = Field(default="", max_length=300)
    last_capture_path: str = Field(default="", max_length=1_000)


class StandupScheduleStatus(BaseModel):
    """Public scheduler state returned to the Connections UI."""

    running: bool
    paused: bool
    next_run_at: str = ""
    state: StandupScheduleState = Field(default_factory=StandupScheduleState)


def _state_path(vault_root: Path) -> Path:
    return vault_root / ".loom" / "standup-schedule.json"


def _load_state(vault_root: Path) -> StandupScheduleState:
    path = _state_path(vault_root)
    try:
        return StandupScheduleState.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return StandupScheduleState()


def _save_state(vault_root: Path, state: StandupScheduleState) -> None:
    path = _state_path(vault_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(state.model_dump(), indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def _scheduled_at(target: date, config: StandupScheduleConfig) -> datetime:
    hour, minute = (int(part) for part in config.run_time.split(":"))
    timezone = ZoneInfo(config.timezone)
    candidate = datetime(target.year, target.month, target.day, hour, minute, tzinfo=timezone)
    # Round-trip through UTC so a nonexistent spring-forward wall time becomes
    # the corresponding first valid local instant instead of a phantom time.
    return candidate.astimezone(UTC).astimezone(timezone)


def _retry_at(now: datetime, last_attempt_at: str) -> datetime | None:
    """Resolve a valid retry instant, or ``None`` for missing/corrupt state."""
    if not last_attempt_at:
        return None
    try:
        previous = datetime.fromisoformat(last_attempt_at)
        if previous.tzinfo is None:
            return None
        previous_utc = previous.astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        return None
    # A far-future value is corrupt and should not suppress today's run. Small
    # clock corrections retain a normal 30-minute retry window.
    if previous_utc - now.astimezone(UTC) > _RETRY_DELAY:
        return None
    return (previous_utc + _RETRY_DELAY).astimezone(now.tzinfo)


def _next_run(
    now: datetime,
    config: StandupScheduleConfig,
    state: StandupScheduleState,
) -> datetime:
    """Return the next instant the scheduler can actually attempt work."""
    today = now.date()
    date_str = today.isoformat()
    tomorrow = _scheduled_at(today + timedelta(days=1), config)

    if state.last_success_date == date_str:
        return tomorrow
    if state.scheduled_date == date_str and state.attempts >= _MAX_DAILY_ATTEMPTS:
        return tomorrow

    nominal = _scheduled_at(today, config)
    if now.astimezone(UTC) < nominal.astimezone(UTC):
        return nominal
    if state.scheduled_date != date_str or state.attempts == 0:
        return now

    retry = _retry_at(now, state.last_attempt_at)
    if retry is None or retry.astimezone(UTC) <= now.astimezone(UTC):
        return now
    # Daily attempt budgets reset at local midnight; a retry that crosses that
    # boundary is superseded by the following day's nominal run.
    if retry.date() != today:
        return tomorrow
    return retry


def _retry_ready(now: datetime, last_attempt_at: str) -> bool:
    if not last_attempt_at:
        return True
    retry = _retry_at(now, last_attempt_at)
    return retry is None or now.astimezone(UTC) >= retry.astimezone(UTC)


def _safe_error(exc: Exception) -> str:
    """Return bounded diagnostic text without private URLs or credentials."""
    text = str(exc).strip() or type(exc).__name__
    text = _PRIVATE_URL_RE.sub("[private URL]", text)
    text = _SECRET_RE.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    text = _OPENAI_KEY_RE.sub("[redacted key]", text)
    text = " ".join(text.split())
    return text[:500] or type(exc).__name__


def _relative_capture_path(vault_root: Path, value: Any) -> str:
    if not value:
        return ""
    try:
        path = Path(str(value)).resolve()
        return path.relative_to(vault_root.resolve()).as_posix()[:1_000]
    except (OSError, ValueError):
        return ""


class StandupSchedulerService:
    """One scheduler loop that follows the currently active vault."""

    def __init__(
        self,
        *,
        interval: float = _CHECK_INTERVAL_SECONDS,
        now: Callable[[ZoneInfo], datetime] | None = None,
    ) -> None:
        self._interval = interval
        self._now = now or (lambda tz: datetime.now(tz))
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()
        self._run_lock = asyncio.Lock()
        self._paused = False

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def paused(self) -> bool:
        """Whether new scheduled runs are paused for an active-vault handoff."""
        return self._paused

    async def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._paused = False
        self._task = asyncio.create_task(self._loop(), name="loom-standup-scheduler")

    async def aclose(self) -> None:
        self._stop.set()
        self._wake.set()
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def prepare_vault_switch(self) -> None:
        """Pause new runs and refuse a handoff while Standup is executing."""
        self._paused = True
        if self._run_lock.locked():
            self._paused = False
            raise StandupScheduleBusyError(
                "A scheduled Standup is running; try again when it finishes"
            )

    def resume(self) -> None:
        self._paused = False
        self._wake.set()

    def notify(self) -> None:
        self._wake.set()

    def status(
        self,
        vault_root: Path,
        config: StandupScheduleConfig,
    ) -> StandupScheduleStatus:
        now = self._now(ZoneInfo(config.timezone))
        state = _load_state(vault_root)
        return StandupScheduleStatus(
            running=self._run_lock.locked(),
            paused=self._paused,
            next_run_at=_next_run(now, config, state).isoformat() if config.enabled else "",
            state=state,
        )

    async def run_due_once(self) -> bool:
        """Run today's scheduled Standup when due; return whether attempted."""
        if self._paused:
            return False
        from core.vault import get_vault_manager

        vm = get_vault_manager()
        async with self._run_lock:
            if self._paused:
                return False
            vault_root = vm.active_vault_dir().resolve()
            config = GlobalConfig.load(vm.config_path())
            schedule = config.standup_schedule
            if not schedule.enabled or not vault_root.exists():
                return False
            now = self._now(ZoneInfo(schedule.timezone))
            today = now.date()
            if now.astimezone(UTC) < _scheduled_at(today, schedule).astimezone(UTC):
                return False
            state = _load_state(vault_root)
            date_str = today.isoformat()
            if state.last_success_date == date_str:
                return False
            if state.scheduled_date != date_str:
                state = StandupScheduleState(scheduled_date=date_str)
            elif state.attempts >= _MAX_DAILY_ATTEMPTS or not _retry_ready(
                now, state.last_attempt_at
            ):
                return False
            if self._paused or vm.active_vault_dir().resolve() != vault_root:
                return False
            state.attempts += 1
            state.last_attempt_at = now.astimezone(UTC).isoformat()
            _save_state(vault_root, state)
            try:
                result = await self._run_standup(today, config)
            except Exception as exc:  # keep scheduler alive; UI exposes safe text
                state.last_error = _safe_error(exc)
                logger.warning("Scheduled Standup failed: %s", state.last_error)
                _save_state(vault_root, state)
            else:
                state.last_success_date = date_str
                state.last_success_at = datetime.now(UTC).isoformat()
                state.last_error = ""
                state.last_capture_id = str(result.get("capture_id", ""))[:300]
                state.last_capture_path = _relative_capture_path(
                    vault_root, result.get("capture_path", "")
                )
                _save_state(vault_root, state)
            get_event_hub().publish(STANDUP_SCHEDULE_CHANGED)
            return True

    async def _run_standup(self, target_date: date, config: GlobalConfig) -> dict[str, Any]:
        # Calendar event capture sync happens first, so the generated Standup
        # can link to/mention the same external occurrences. Import lazily to
        # avoid a scheduler/config/ingress import cycle at process startup.
        if config.calendar.enabled and config.calendar.create_captures:
            from bridge.service import CalendarSyncConflictError, sync_calendar_date
            from core.capture_jobs import CaptureJobsBusyError

            try:
                await sync_calendar_date(target_date)
            except (CalendarSyncConflictError, CaptureJobsBusyError):
                raise
            except Exception as exc:
                # Calendar capture creation is optional enrichment. The Standup
                # agent independently handles unavailable calendar context, so
                # a feed outage must not suppress the daily vault recap.
                logger.warning("Optional calendar capture sync failed: %s", _safe_error(exc))

        from agents.runner import get_runner

        runner = get_runner()
        if runner is None:
            raise RuntimeError("Standup agent runner is not initialized")
        result = await runner.run_scheduled("standup", date=target_date)
        if "error" in result:
            raise RuntimeError(str(result["error"]))
        return result

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self.run_due_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Standup scheduler tick failed: %s", _safe_error(exc))
            self._wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=self._interval)


_service = StandupSchedulerService()


def get_standup_scheduler() -> StandupSchedulerService:
    return _service


async def reset_standup_scheduler_for_tests() -> None:
    global _service
    await _service.aclose()
    _service = StandupSchedulerService()

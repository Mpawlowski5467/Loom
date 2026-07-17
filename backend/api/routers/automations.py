"""Standup scheduling and read-only Calendar Bridge endpoints."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from bridge.calendar import CalendarEvent, CalendarFeedError, events_for_date
from bridge.service import CalendarSyncConflictError
from core.capture_jobs import CaptureJobsBusyError
from core.config import (
    CalendarBridgeConfig,
    CalendarBridgeConfigPublic,
    GlobalConfig,
    StandupScheduleConfig,
)
from core.events import STANDUP_SCHEDULE_CHANGED, get_event_hub
from core.rate_limit import WRITE_LIMIT, limiter
from core.standup_scheduler import StandupScheduleStatus, get_standup_scheduler
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/automations", tags=["automations"])


class StandupSchedulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    run_time: str | None = None
    timezone: str | None = None


class CalendarBridgePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    feed_url: str | None = None
    clear_feed_url: bool = False
    name: str | None = None
    include_in_standup: bool | None = None
    create_captures: bool | None = None


class StandupAutomationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule: StandupSchedulePatch | None = None
    calendar: CalendarBridgePatch | None = None


class StandupAutomationResponse(BaseModel):
    schedule: StandupScheduleConfig
    calendar: CalendarBridgeConfigPublic
    status: StandupScheduleStatus


class CalendarDateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: str = Field(default="", max_length=10)

    @field_validator("date")
    @classmethod
    def _valid_date_shape(cls, value: str) -> str:
        if value and (len(value) != 10 or value[4] != "-" or value[7] != "-"):
            raise ValueError("date must use YYYY-MM-DD format")
        return value


class CalendarEventPreview(BaseModel):
    external_id: str
    title: str
    start: str
    end: str
    all_day: bool
    location: str


class CalendarTestResponse(BaseModel):
    date: str
    event_count: int
    events: list[CalendarEventPreview]


class CalendarSyncResponse(BaseModel):
    date: str
    event_count: int
    created: int
    deduplicated: int
    capture_ids: list[str]


def _response(vm: VaultManager, config: GlobalConfig) -> StandupAutomationResponse:
    scheduler = get_standup_scheduler()
    return StandupAutomationResponse(
        schedule=config.standup_schedule,
        calendar=config.calendar.to_public(),
        status=scheduler.status(vm.active_vault_dir(), config.standup_schedule),
    )


def _target_date(raw: str, timezone: str) -> date:
    if not raw:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo(timezone)).date()
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="date must use YYYY-MM-DD format") from exc


def _calendar_or_409(config: GlobalConfig) -> str:
    if not config.calendar.feed_url:
        raise HTTPException(status_code=409, detail="Connect a calendar feed first")
    return config.calendar.feed_url


def _validation_detail(exc: ValidationError) -> str:
    """Format validation failures without echoing private submitted values."""
    messages = [
        str(error.get("msg") or "Invalid automation setting")
        for error in exc.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )
    ]
    return "; ".join(messages) or "Invalid automation setting"


def _preview(event: CalendarEvent) -> CalendarEventPreview:
    return CalendarEventPreview(
        external_id=event.external_id,
        title=event.title,
        start=event.start.isoformat(),
        end=event.end.isoformat(),
        all_day=event.all_day,
        location=event.location,
    )


@router.get("/standup", response_model=StandupAutomationResponse)
def get_standup_automation(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> StandupAutomationResponse:
    """Return schedule, redacted calendar connection, and durable run state."""
    return _response(vm, GlobalConfig.load(vm.config_path()))


@router.patch("/standup", response_model=StandupAutomationResponse)
@limiter.limit(WRITE_LIMIT)
async def patch_standup_automation(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: StandupAutomationPatch,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> StandupAutomationResponse:
    """Validate, persist, and immediately apply Standup/Calendar settings."""
    config = GlobalConfig.load(vm.config_path())
    try:
        if body.schedule is not None:
            updates = body.schedule.model_dump(exclude_none=True)
            config.standup_schedule = StandupScheduleConfig.model_validate(
                {**config.standup_schedule.model_dump(), **updates}
            )
        if body.calendar is not None:
            patch = body.calendar
            updates = patch.model_dump(exclude_none=True, exclude={"clear_feed_url"})
            if patch.clear_feed_url:
                updates["feed_url"] = None
            config.calendar = CalendarBridgeConfig.model_validate(
                {**config.calendar.model_dump(), **updates}
            )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_validation_detail(exc)) from exc
    except CalendarFeedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if config.calendar.enabled and not config.calendar.feed_url:
        raise HTTPException(status_code=422, detail="A calendar feed URL is required when enabled")
    config.save(vm.config_path())
    scheduler = get_standup_scheduler()
    scheduler.notify()
    get_event_hub().publish(STANDUP_SCHEDULE_CHANGED)
    return _response(vm, config)


@router.post("/calendar/test", response_model=CalendarTestResponse)
@limiter.limit(WRITE_LIMIT)
async def test_calendar_connection(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: CalendarDateRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CalendarTestResponse:
    """Fetch the configured feed and return a privacy-bounded event preview."""
    config = GlobalConfig.load(vm.config_path())
    target = _target_date(body.date, config.standup_schedule.timezone)
    try:
        events = await events_for_date(
            _calendar_or_409(config),
            target,
            config.standup_schedule.timezone,
            calendar_name=config.calendar.name,
        )
    except CalendarFeedError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return CalendarTestResponse(
        date=target.isoformat(),
        event_count=len(events),
        events=[_preview(event) for event in events[:25]],
    )


@router.post("/calendar/sync", response_model=CalendarSyncResponse)
@limiter.limit(WRITE_LIMIT)
async def sync_calendar(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: CalendarDateRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CalendarSyncResponse:
    """Create idempotent Inbox captures for one calendar day."""
    config = GlobalConfig.load(vm.config_path())
    target = _target_date(body.date, config.standup_schedule.timezone)
    _calendar_or_409(config)
    try:
        from bridge.service import sync_calendar_date

        result = await sync_calendar_date(target, vm=vm)
    except CalendarFeedError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (CalendarSyncConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return CalendarSyncResponse(**result)

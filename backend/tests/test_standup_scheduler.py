"""Durability and due-time behavior for the Standup scheduler."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest

from bridge.calendar import CalendarFeedError
from core.config import CalendarBridgeConfig, GlobalConfig, LoomSettings, StandupScheduleConfig
from core.standup_scheduler import (
    StandupScheduleBusyError,
    StandupSchedulerService,
    StandupScheduleState,
    _load_state,
    _save_state,
)
from core.vault import VaultManager


def _manager(tmp_path, monkeypatch, *, run_time: str = "08:00"):
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    manager.init_vault("test")
    manager.set_active_vault("test")
    config = GlobalConfig.load(manager.config_path())
    config.active_vault = "test"
    config.standup_schedule = StandupScheduleConfig(
        enabled=True,
        run_time=run_time,
        timezone="America/Chicago",
    )
    config.save(manager.config_path())
    monkeypatch.setattr("core.vault.get_vault_manager", lambda: manager)
    return manager


@pytest.mark.asyncio
async def test_due_run_persists_success_and_only_runs_once(tmp_path, monkeypatch) -> None:
    manager = _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 8, 5, tzinfo=ZoneInfo("America/Chicago"))
    service = StandupSchedulerService(interval=0.01, now=lambda tz: now.astimezone(tz))
    service._run_standup = AsyncMock(
        return_value={"capture_id": "thr_standup", "capture_path": "/capture.md"}
    )

    assert await service.run_due_once() is True
    assert await service.run_due_once() is False

    state = _load_state(manager.active_vault_dir())
    assert state.last_success_date == "2026-07-14"
    assert state.attempts == 1
    assert state.last_capture_id == "thr_standup"
    assert state.last_capture_path == ""
    service._run_standup.assert_awaited_once()


@pytest.mark.asyncio
async def test_concurrent_due_checks_only_run_once(tmp_path, monkeypatch) -> None:
    _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 8, 5, tzinfo=ZoneInfo("America/Chicago"))
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    service._run_standup = AsyncMock(return_value={})

    attempted = await asyncio.gather(service.run_due_once(), service.run_due_once())

    assert sorted(attempted) == [False, True]
    service._run_standup.assert_awaited_once()


@pytest.mark.asyncio
async def test_not_due_before_configured_time(tmp_path, monkeypatch) -> None:
    _manager(tmp_path, monkeypatch, run_time="09:30")
    now = datetime(2026, 7, 14, 9, 29, tzinfo=ZoneInfo("America/Chicago"))
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    service._run_standup = AsyncMock(return_value={})

    assert await service.run_due_once() is False
    service._run_standup.assert_not_awaited()


@pytest.mark.asyncio
async def test_failure_waits_before_retry_and_eventually_succeeds(tmp_path, monkeypatch) -> None:
    manager = _manager(tmp_path, monkeypatch)
    clock = [datetime(2026, 7, 14, 8, 5, tzinfo=ZoneInfo("America/Chicago"))]
    service = StandupSchedulerService(now=lambda tz: clock[0].astimezone(tz))
    service._run_standup = AsyncMock(side_effect=[RuntimeError("provider down"), {}])

    assert await service.run_due_once() is True
    assert await service.run_due_once() is False
    state = _load_state(manager.active_vault_dir())
    assert state.last_error == "provider down"

    clock[0] += timedelta(minutes=31)
    assert await service.run_due_once() is True
    state = _load_state(manager.active_vault_dir())
    assert state.last_success_date == "2026-07-14"
    assert state.attempts == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "last_attempt",
    ["2026-07-14T08:00:00", "2999-01-01T00:00:00+00:00", "not-a-timestamp"],
)
async def test_invalid_retry_timestamp_does_not_crash_or_stall(
    tmp_path,
    monkeypatch,
    last_attempt: str,
) -> None:
    manager = _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 8, 5, tzinfo=ZoneInfo("America/Chicago"))
    _save_state(
        manager.active_vault_dir(),
        StandupScheduleState(
            scheduled_date="2026-07-14",
            attempts=1,
            last_attempt_at=last_attempt,
        ),
    )
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    service._run_standup = AsyncMock(return_value={})

    assert await service.run_due_once() is True
    service._run_standup.assert_awaited_once()


@pytest.mark.asyncio
async def test_scheduler_redacts_private_failure_text(tmp_path, monkeypatch) -> None:
    manager = _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 8, 5, tzinfo=ZoneInfo("America/Chicago"))
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    service._run_standup = AsyncMock(
        side_effect=RuntimeError(
            "failed https://calendar.example/private.ics?token=secret api_key=also-secret "
            "sk-proj-1234567890"
        )
    )

    assert await service.run_due_once() is True
    error = _load_state(manager.active_vault_dir()).last_error
    assert "calendar.example" not in error
    assert "also-secret" not in error
    assert "1234567890" not in error
    assert "[private URL]" in error


@pytest.mark.asyncio
async def test_optional_calendar_capture_failure_does_not_suppress_standup(
    tmp_path,
    monkeypatch,
) -> None:
    manager = _manager(tmp_path, monkeypatch)
    config = GlobalConfig.load(manager.config_path())
    config.calendar = CalendarBridgeConfig(
        enabled=True,
        feed_url="https://calendar.example/private.ics",
        create_captures=True,
    )
    runner = type(
        "Runner",
        (),
        {"run_scheduled": AsyncMock(return_value={"capture_id": "thr_standup"})},
    )()

    async def fail_sync(*args, **kwargs):
        raise CalendarFeedError("Calendar feed timed out")

    monkeypatch.setattr("bridge.service.sync_calendar_date", fail_sync)
    monkeypatch.setattr("agents.runner.get_runner", lambda: runner)
    service = StandupSchedulerService()

    result = await service._run_standup(date(2026, 7, 14), config)

    assert result["capture_id"] == "thr_standup"
    runner.run_scheduled.assert_awaited_once_with("standup", date=date(2026, 7, 14))


def test_status_reports_immediately_due_local_run(tmp_path, monkeypatch) -> None:
    manager = _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 9, 0, tzinfo=ZoneInfo("America/Chicago"))
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    config = GlobalConfig.load(manager.config_path()).standup_schedule

    status = service.status(manager.active_vault_dir(), config)

    assert datetime.fromisoformat(status.next_run_at) == now
    assert status.running is False


def test_status_reports_today_before_nominal_time(tmp_path, monkeypatch) -> None:
    manager = _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 7, 0, tzinfo=ZoneInfo("America/Chicago"))
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    config = GlobalConfig.load(manager.config_path()).standup_schedule

    status = service.status(manager.active_vault_dir(), config)

    next_run = datetime.fromisoformat(status.next_run_at)
    assert next_run == datetime(2026, 7, 14, 8, 0, tzinfo=ZoneInfo("America/Chicago"))
    assert next_run.tzinfo is not None


def test_status_reports_durable_retry_window(tmp_path, monkeypatch) -> None:
    manager = _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 8, 10, tzinfo=ZoneInfo("America/Chicago"))
    _save_state(
        manager.active_vault_dir(),
        StandupScheduleState(
            scheduled_date="2026-07-14",
            attempts=1,
            last_attempt_at="2026-07-14T13:05:00+00:00",
            last_error="provider down",
        ),
    )
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    config = GlobalConfig.load(manager.config_path()).standup_schedule

    status = service.status(manager.active_vault_dir(), config)

    assert datetime.fromisoformat(status.next_run_at) == datetime(
        2026, 7, 14, 8, 35, tzinfo=ZoneInfo("America/Chicago")
    )


@pytest.mark.parametrize("completed", ["success", "max-attempts"])
def test_status_reports_tomorrow_after_daily_terminal_state(
    tmp_path,
    monkeypatch,
    completed: str,
) -> None:
    manager = _manager(tmp_path, monkeypatch)
    now = datetime(2026, 7, 14, 9, 0, tzinfo=ZoneInfo("America/Chicago"))
    state = StandupScheduleState(
        scheduled_date="2026-07-14",
        attempts=1 if completed == "success" else 3,
        last_success_date="2026-07-14" if completed == "success" else "",
    )
    _save_state(manager.active_vault_dir(), state)
    service = StandupSchedulerService(now=lambda tz: now.astimezone(tz))
    config = GlobalConfig.load(manager.config_path()).standup_schedule

    status = service.status(manager.active_vault_dir(), config)

    assert datetime.fromisoformat(status.next_run_at) == datetime(
        2026, 7, 15, 8, 0, tzinfo=ZoneInfo("America/Chicago")
    )


@pytest.mark.asyncio
async def test_prepare_vault_switch_refuses_an_active_run_without_staying_paused() -> None:
    service = StandupSchedulerService()
    await service._run_lock.acquire()
    try:
        with pytest.raises(StandupScheduleBusyError, match="scheduled Standup is running"):
            await service.prepare_vault_switch()
    finally:
        service._run_lock.release()

    assert service.paused is False

"""Standup integration with the read-only Calendar Bridge."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from agents.shuttle.standup import Standup
from bridge.calendar import CalendarEvent, CalendarFeedError
from core.config import CalendarBridgeConfig, GlobalConfig, LoomSettings, StandupScheduleConfig
from core.vault import VaultManager


def _configured_vault(tmp_path):
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    manager.init_vault("test")
    manager.set_active_vault("test")
    config = GlobalConfig.load(manager.config_path())
    config.active_vault = "test"
    config.calendar = CalendarBridgeConfig(
        enabled=True,
        feed_url="https://calendar.example/private.ics",
        name="Work",
        include_in_standup=True,
    )
    config.standup_schedule = StandupScheduleConfig(
        enabled=False,
        run_time="08:00",
        timezone="America/Chicago",
    )
    config.save(manager.config_path())
    return manager.active_vault_dir()


@pytest.mark.asyncio
async def test_calendar_only_day_generates_standup(tmp_path, monkeypatch) -> None:
    root = _configured_vault(tmp_path)
    event = CalendarEvent(
        uid="planning",
        title="Planning",
        start=datetime(2026, 7, 14, 9, tzinfo=ZoneInfo("America/Chicago")),
        end=datetime(2026, 7, 14, 10, tzinfo=ZoneInfo("America/Chicago")),
        all_day=False,
        location="Room 4",
    )

    async def fake_events(*args, **kwargs):
        return [event]

    monkeypatch.setattr("bridge.calendar.events_for_date", fake_events)
    result = await Standup(root, None).generate(date(2026, 7, 14))

    assert result.calendar_events == 1
    assert result.calendar_error == ""
    assert "Planning" in result.recap
    assert result.capture_id


@pytest.mark.asyncio
async def test_calendar_failure_is_reported_without_raising(tmp_path, monkeypatch) -> None:
    root = _configured_vault(tmp_path)

    async def fail(*args, **kwargs):
        raise CalendarFeedError("Calendar feed timed out")

    monkeypatch.setattr("bridge.calendar.events_for_date", fail)
    result = await Standup(root, None).generate(date(2026, 7, 14))

    assert result.recap == ""
    assert result.calendar_events == 0
    assert result.calendar_error == "Calendar feed timed out"

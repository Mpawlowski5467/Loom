"""End-to-end Calendar occurrence → capture ingress → durable job coverage."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from bridge.calendar import CalendarEvent
from bridge.service import CalendarSyncConflictError, sync_calendar_date
from core.capture_jobs import capture_job_store
from core.config import (
    CalendarBridgeConfig,
    CaptureProcessingConfig,
    GlobalConfig,
    LoomSettings,
    StandupScheduleConfig,
)
from core.notes import parse_note
from core.vault import VaultManager


@pytest.mark.asyncio
async def test_sync_is_idempotent_and_immediately_creates_trusted_job(
    tmp_path,
    monkeypatch,
) -> None:
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    manager.init_vault("test")
    manager.set_active_vault("test")
    config = GlobalConfig.load(manager.config_path())
    config.active_vault = "test"
    config.calendar = CalendarBridgeConfig(
        enabled=True,
        feed_url="https://calendar.example/private.ics",
        name="Work",
        create_captures=True,
    )
    config.standup_schedule = StandupScheduleConfig(
        run_time="08:00",
        timezone="America/Chicago",
    )
    config.capture_processing = CaptureProcessingConfig(
        mode="trusted",
        trusted_sources=["bridge:calendar"],
    )
    config.save(manager.config_path())
    event = CalendarEvent(
        uid="event-one",
        title="Planning",
        start=datetime(2026, 7, 14, 9, tzinfo=ZoneInfo("America/Chicago")),
        end=datetime(2026, 7, 14, 10, tzinfo=ZoneInfo("America/Chicago")),
        all_day=False,
        description="Roadmap review",
        location="Room 4",
        attendees=("Alex",),
        calendar_name="Work",
    )

    async def fake_events(*args, **kwargs):
        return [event]

    monkeypatch.setattr("bridge.service.events_for_date", fake_events)

    first = await sync_calendar_date(date(2026, 7, 14), vm=manager)
    second = await sync_calendar_date(date(2026, 7, 14), vm=manager)

    assert first["created"] == 1
    assert first["deduplicated"] == 0
    assert second["created"] == 0
    assert second["deduplicated"] == 1
    captures = list((manager.active_vault_dir() / "threads" / "captures").glob("*.md"))
    assert len(captures) == 1
    capture = parse_note(captures[0])
    assert capture.source == "bridge:calendar"
    assert capture.extra["external_id"] == event.external_id
    assert capture.extra["provenance"]["event_uid"] == "event-one"
    assert capture.extra["provenance"]["all_day"] is False
    assert "Roadmap review" in capture.body
    jobs = capture_job_store(manager.active_vault_dir()).list_jobs()
    assert len(jobs) == 1
    assert jobs[0].capture_id == capture.id
    assert jobs[0].source == "bridge:calendar"


@pytest.mark.asyncio
async def test_sync_refuses_to_write_after_active_vault_changes(tmp_path, monkeypatch) -> None:
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    manager.init_vault("one")
    manager.init_vault("two")
    manager.set_active_vault("one")
    config = GlobalConfig.load(manager.config_path())
    config.calendar = CalendarBridgeConfig(
        enabled=True,
        feed_url="https://calendar.example/private.ics",
    )
    config.save(manager.config_path())
    event = CalendarEvent(
        uid="event-one",
        title="Planning",
        start=datetime(2026, 7, 14, 9, tzinfo=ZoneInfo("America/Chicago")),
        end=datetime(2026, 7, 14, 10, tzinfo=ZoneInfo("America/Chicago")),
        all_day=False,
    )

    async def switch_during_fetch(*args, **kwargs):
        manager.set_active_vault("two")
        return [event]

    monkeypatch.setattr("bridge.service.events_for_date", switch_during_fetch)

    with pytest.raises(CalendarSyncConflictError, match="active vault changed"):
        await sync_calendar_date(date(2026, 7, 14), vm=manager)
    assert not list((manager._settings.vaults_dir / "one" / "threads" / "captures").glob("*.md"))
    assert not list((manager._settings.vaults_dir / "two" / "threads" / "captures").glob("*.md"))

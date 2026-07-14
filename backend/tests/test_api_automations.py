"""HTTP coverage for Standup scheduling and Calendar Bridge settings."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from starlette.testclient import TestClient

from bridge.calendar import CalendarEvent, CalendarFeedError
from bridge.service import CalendarSyncConflictError
from core.config import CalendarBridgeConfig, GlobalConfig


def _init(vault_manager) -> Path:
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    return vault_manager.active_vault_dir()


def test_get_defaults_are_redacted(client: TestClient, vault_manager) -> None:
    _init(vault_manager)
    response = client.get("/api/automations/standup")
    assert response.status_code == 200
    body = response.json()
    assert body["schedule"] == {"enabled": False, "run_time": "08:00", "timezone": "UTC"}
    assert body["calendar"]["feed_url_set"] is False
    assert "feed_url" not in body["calendar"]


def test_patch_schedule_and_private_calendar(
    client: TestClient,
    vault_manager,
) -> None:
    _init(vault_manager)
    url = "webcal://calendar.example/private.ics?token=secret"
    response = client.patch(
        "/api/automations/standup",
        json={
            "schedule": {
                "enabled": True,
                "run_time": "07:30",
                "timezone": "America/Chicago",
            },
            "calendar": {
                "enabled": True,
                "feed_url": url,
                "name": "Work",
                "include_in_standup": True,
                "create_captures": True,
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["calendar"] == {
        "enabled": True,
        "feed_url_set": True,
        "name": "Work",
        "include_in_standup": True,
        "create_captures": True,
    }
    persisted = vault_manager.config_path().read_text(encoding="utf-8")
    assert "secret" not in persisted
    loaded = GlobalConfig.load(vault_manager.config_path())
    assert loaded.calendar.feed_url == "https://calendar.example/private.ics?token=secret"


@pytest.mark.parametrize(
    ("payload", "detail"),
    [
        ({"schedule": {"run_time": "25:00"}}, "HH:MM"),
        ({"schedule": {"timezone": "Mars/Olympus"}}, "IANA"),
        ({"calendar": {"enabled": True}}, "feed URL"),
        ({"calendar": {"feed_url": "file:///tmp/private.ics"}}, "http"),
    ],
)
def test_patch_rejects_invalid_settings(
    client: TestClient,
    vault_manager,
    payload: dict,
    detail: str,
) -> None:
    _init(vault_manager)
    response = client.patch("/api/automations/standup", json=payload)
    assert response.status_code == 422
    assert detail.lower() in str(response.json()["detail"]).lower()


def test_calendar_test_returns_event_preview(
    client: TestClient,
    vault_manager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _init(vault_manager)
    config = GlobalConfig.load(vault_manager.config_path())
    config.calendar.feed_url = "https://calendar.example/private.ics"
    config.calendar.enabled = True
    config.standup_schedule.timezone = "America/Chicago"
    config.save(vault_manager.config_path())
    event = CalendarEvent(
        uid="one",
        title="Planning",
        start=datetime(2026, 7, 14, 9, tzinfo=ZoneInfo("America/Chicago")),
        end=datetime(2026, 7, 14, 10, tzinfo=ZoneInfo("America/Chicago")),
        all_day=False,
        location="Room 4",
    )

    async def fake_events(*args, **kwargs):
        return [event]

    monkeypatch.setattr("api.routers.automations.events_for_date", fake_events)
    response = client.post("/api/automations/calendar/test", json={"date": "2026-07-14"})
    assert response.status_code == 200
    assert response.json()["event_count"] == 1
    assert response.json()["events"][0]["title"] == "Planning"


def test_calendar_test_surfaces_safe_fetch_error(
    client: TestClient,
    vault_manager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _init(vault_manager)
    config = GlobalConfig.load(vault_manager.config_path())
    config.calendar.feed_url = "https://calendar.example/private.ics"
    config.save(vault_manager.config_path())

    async def fail(*args, **kwargs):
        raise CalendarFeedError("Calendar feed timed out")

    monkeypatch.setattr("api.routers.automations.events_for_date", fail)
    response = client.post("/api/automations/calendar/test", json={})
    assert response.status_code == 502
    assert response.json()["detail"] == "Calendar feed timed out"


def test_calendar_sync_delegates_to_bridge_service(
    client: TestClient,
    vault_manager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _init(vault_manager)
    config = GlobalConfig.load(vault_manager.config_path())
    config.calendar = CalendarBridgeConfig(
        enabled=True,
        feed_url="https://calendar.example/private.ics",
    )
    config.save(vault_manager.config_path())
    seen = []

    async def fake_sync(target, *, vm):
        seen.append((target.isoformat(), vm))
        return {
            "date": target.isoformat(),
            "event_count": 2,
            "created": 1,
            "deduplicated": 1,
            "capture_ids": ["thr_one", "thr_two"],
        }

    monkeypatch.setattr("bridge.service.sync_calendar_date", fake_sync)
    response = client.post("/api/automations/calendar/sync", json={"date": "2026-07-14"})
    assert response.status_code == 200
    assert response.json()["created"] == 1
    assert seen == [("2026-07-14", vault_manager)]


def test_calendar_sync_requires_a_connection(client: TestClient, vault_manager) -> None:
    _init(vault_manager)
    response = client.post("/api/automations/calendar/sync", json={})
    assert response.status_code == 409
    assert response.json()["detail"] == "Connect a calendar feed first"


def test_calendar_sync_maps_vault_handoff_conflict(
    client: TestClient,
    vault_manager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _init(vault_manager)
    config = GlobalConfig.load(vault_manager.config_path())
    config.calendar = CalendarBridgeConfig(
        enabled=True,
        feed_url="https://calendar.example/private.ics",
    )
    config.save(vault_manager.config_path())

    async def fail(*args, **kwargs):
        raise CalendarSyncConflictError("The active vault changed; retry calendar sync")

    monkeypatch.setattr("bridge.service.sync_calendar_date", fail)
    response = client.post("/api/automations/calendar/sync", json={})
    assert response.status_code == 409
    assert "active vault changed" in response.json()["detail"]


def test_calendar_date_requires_extended_iso_format(client: TestClient, vault_manager) -> None:
    _init(vault_manager)
    response = client.post("/api/automations/calendar/test", json={"date": "20260714"})
    assert response.status_code == 422
    assert "YYYY-MM-DD" in str(response.json())


def test_private_feed_validation_does_not_echo_secret(
    client: TestClient,
    vault_manager,
) -> None:
    _init(vault_manager)
    secret = "do-not-echo"
    response = client.patch(
        "/api/automations/standup",
        json={"calendar": {"feed_url": f"http://127.0.0.1/feed.ics?token={secret}"}},
    )
    assert response.status_code == 422
    assert secret not in response.text

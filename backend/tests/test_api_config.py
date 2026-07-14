"""Integration tests for /api/config."""

import asyncio
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import api.routers.config as config_routes
import core.vault_handoff as handoff_mod
from core.notes import note_to_file_content
from core.standup_scheduler import StandupSchedulerService


def _write_note(vault_root: Path, note_id: str, title: str) -> None:
    path = vault_root / "threads" / "topics" / f"{note_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        note_to_file_content(
            {
                "id": note_id,
                "title": title,
                "type": "topic",
                "tags": [],
                "history": [],
            },
            "Body",
        )
    )


def test_patch_active_vault_validates_name(client: TestClient) -> None:
    resp = client.patch("/api/config", json={"active_vault": "../outside"})

    assert resp.status_code == 422


def test_patch_active_vault_requires_existing_vault(client: TestClient) -> None:
    resp = client.patch("/api/config", json={"active_vault": "missing"})

    assert resp.status_code == 404


def test_patch_active_vault_rebuilds_runtime_index(
    client: TestClient,
    vault_manager,
    note_index,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.post("/api/vaults", json={"name": "first"})
    client.post("/api/vaults", json={"name": "second"})
    _write_note(vault_manager.vault_path("first"), "thr_first", "First Note")
    _write_note(vault_manager.vault_path("second"), "thr_second", "Second Note")
    note_index.build(vault_manager.vault_path("first") / "threads")
    scheduler = StandupSchedulerService()
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)

    resp = client.patch("/api/config", json={"active_vault": "second"})

    assert resp.status_code == 200
    assert resp.json()["active_vault"] == "second"
    notes = client.get("/api/notes").json()["notes"]
    assert [n["title"] for n in notes] == ["Second Note"]
    assert scheduler.paused is False


def test_patch_active_vault_resumes_scheduler_after_reload_failure(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.post("/api/vaults", json={"name": "first"})
    client.post("/api/vaults", json={"name": "second"})
    scheduler = StandupSchedulerService()
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
    monkeypatch.setattr(
        config_routes,
        "reload_active_vault_runtime",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("reload failed")),
    )

    resp = client.patch("/api/config", json={"active_vault": "second"})

    assert resp.status_code == 409
    assert client.get("/api/vaults/active").json()["name"] == "first"
    assert scheduler.paused is False


def test_patch_active_vault_refuses_running_scheduled_standup(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.post("/api/vaults", json={"name": "first"})
    client.post("/api/vaults", json={"name": "second"})
    scheduler = StandupSchedulerService()
    asyncio.run(scheduler._run_lock.acquire())
    monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
    try:
        resp = client.patch("/api/config", json={"active_vault": "second"})
    finally:
        scheduler._run_lock.release()

    assert resp.status_code == 409
    assert client.get("/api/vaults/active").json()["name"] == "first"
    assert scheduler.paused is False

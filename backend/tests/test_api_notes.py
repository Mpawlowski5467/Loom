"""Tests for the notes, tree, and graph API routes."""

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

import api.routers.notes as notes_routes
from agents.file_locks import path_lock
from core.events import NOTE_CHANGED, get_event_hub
from core.notes import parse_note
from tests.conftest import _seed_notes

_NOTES = [
    (
        "topics",
        "python.md",
        {
            "id": "thr_aaa111",
            "title": "Python",
            "type": "topic",
            "tags": ["lang"],
            "created": "2026-01-01T00:00:00+00:00",
            "modified": "2026-01-01T00:00:00+00:00",
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## About\n\nSee also [[FastAPI]].\n",
    ),
    (
        "topics",
        "fastapi.md",
        {
            "id": "thr_bbb222",
            "title": "FastAPI",
            "type": "topic",
            "tags": ["web"],
            "created": "2026-01-01T00:00:00+00:00",
            "modified": "2026-01-01T00:00:00+00:00",
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## About\n\nBuilt on [[Python]].\n",
    ),
    (
        "projects",
        "loom.md",
        {
            "id": "thr_ccc333",
            "title": "Loom",
            "type": "project",
            "tags": ["ai"],
            "created": "2026-01-01T00:00:00+00:00",
            "modified": "2026-01-01T00:00:00+00:00",
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## About\n\nUses [[Python]] and [[FastAPI]].\n",
    ),
]


@pytest.fixture()
def seeded_vault(vault_manager, note_index):
    """Create a vault with a few test notes."""
    return _seed_notes(vault_manager, note_index, _NOTES)


# -- Notes endpoints ----------------------------------------------------------


def test_list_notes(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/notes")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["notes"]) == 3


def test_list_notes_pagination(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/notes?offset=0&limit=2")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["notes"]) == 2


def test_get_note_by_id(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/notes/thr_aaa111")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "thr_aaa111"
    assert data["title"] == "Python"
    assert "FastAPI" in data["wikilinks"]


def test_get_note_not_found(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/notes/thr_zzzzzz")
    assert resp.status_code == 404


def test_create_note(client: TestClient, seeded_vault: Path) -> None:
    resp = client.post(
        "/api/notes",
        json={
            "title": "New Topic",
            "type": "topic",
            "tags": ["test"],
            "content": "## Hello\n\nWorld.\n",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "New Topic"
    assert data["id"].startswith("thr_")
    assert data["type"] == "topic"


def test_note_mutations_emit_only_note_domain(client: TestClient, seeded_vault: Path) -> None:
    hub = get_event_hub()
    events = hub.subscribe()
    try:
        # Agent singletons may still point at a vault used by an earlier API
        # suite. This event-domain test exercises the direct note route and
        # must not depend on process-global Weaver lifecycle state.
        with patch("agents.loom.weaver.get_weaver", return_value=None):
            created = client.post(
                "/api/notes",
                json={"title": "Evented", "type": "topic", "content": "First"},
            )
        assert created.status_code == 201
        note_id = created.json()["id"]
        assert client.put(f"/api/notes/{note_id}", json={"body": "Second"}).status_code == 200
        assert client.delete(f"/api/notes/{note_id}").status_code == 200

        delivered: list[str] = []
        while not events.empty():
            delivered.append(events.get_nowait())
        assert delivered == [NOTE_CHANGED, NOTE_CHANGED, NOTE_CHANGED]
    finally:
        hub.unsubscribe(events)


def test_create_note_does_not_overwrite_same_title(client: TestClient, seeded_vault: Path) -> None:
    """Two notes with the same title in the same folder must both survive.

    Regression: the direct-write fallback used to clobber an existing file whose
    kebab stem matched, silently destroying a note (deletion = archive only).
    """
    payload = {"title": "Duplicate Name", "type": "topic", "tags": []}

    first = client.post("/api/notes", json=payload)
    assert first.status_code == 201
    first_id = first.json()["id"]
    first_path = first.json()["file_path"]

    second = client.post("/api/notes", json=payload)
    assert second.status_code == 201
    second_id = second.json()["id"]
    second_path = second.json()["file_path"]

    # Distinct ids, distinct files — the first note is not overwritten.
    assert first_id != second_id
    assert first_path != second_path
    assert Path(first_path).exists()
    assert Path(second_path).exists()

    # The original is still fetchable.
    again = client.get(f"/api/notes/{first_id}")
    assert again.status_code == 200
    assert again.json()["title"] == "Duplicate Name"


def test_update_note(client: TestClient, seeded_vault: Path) -> None:
    resp = client.put(
        "/api/notes/thr_aaa111",
        json={
            "body": "## Updated\n\nNew content.\n",
            "tags": ["lang", "updated"],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["tags"] == ["lang", "updated"]
    assert "Updated" in data["body"]
    assert len(data["history"]) == 1  # the edit entry


def test_archive_note(client: TestClient, seeded_vault: Path) -> None:
    resp = client.delete("/api/notes/thr_bbb222")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "archived"
    assert ".archive" in data["path"]

    # Should no longer appear in listing
    resp2 = client.get("/api/notes")
    ids = [n["id"] for n in resp2.json()["notes"]]
    assert "thr_bbb222" not in ids

    archived = parse_note(Path(data["path"]))
    assert archived.status == "archived"
    assert archived.history[-1].action == "archived"


def test_archive_rejects_stale_version(client: TestClient, seeded_vault: Path) -> None:
    loaded = client.get("/api/notes/thr_aaa111").json()
    update = client.put(
        "/api/notes/thr_aaa111",
        json={"body": "A concurrent edit", "base_modified": loaded["modified"]},
    )
    assert update.status_code == 200

    resp = client.delete(
        "/api/notes/thr_aaa111",
        params={"base_modified": loaded["modified"]},
    )

    assert resp.status_code == 409
    current = client.get("/api/notes/thr_aaa111")
    assert current.status_code == 200
    assert current.json()["body"] == "A concurrent edit"


def test_archive_move_failure_restores_original(
    client: TestClient,
    seeded_vault: Path,
    note_index,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = note_index.get_path_by_id("thr_bbb222")
    assert path is not None
    original = path.read_text(encoding="utf-8")

    def fail_move(source: Path, destination: Path) -> None:  # noqa: ARG001
        raise OSError("injected move failure")

    monkeypatch.setattr(notes_routes, "_move_note_to_archive", fail_move)

    resp = client.delete("/api/notes/thr_bbb222")

    assert resp.status_code == 500
    assert path.read_text(encoding="utf-8") == original
    assert parse_note(path).status == "active"
    assert note_index.get_path_by_id("thr_bbb222") == path
    assert not list((seeded_vault / "threads" / ".archive").glob("fastapi*.md"))


def test_archive_destination_race_does_not_overwrite_external_file(
    client: TestClient,
    seeded_vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Archive retries another name if a destination appears after selection."""
    expected = seeded_vault / "threads" / ".archive" / "topics" / "fastapi.md"
    real_move = notes_routes._move_note_to_archive
    first_attempt = True

    def race_move(source: Path, destination: Path) -> None:
        nonlocal first_attempt
        if first_attempt:
            first_attempt = False
            destination.write_text("external archive entry\n", encoding="utf-8")
        real_move(source, destination)

    monkeypatch.setattr(notes_routes, "_move_note_to_archive", race_move)
    response = client.delete("/api/notes/thr_bbb222")

    assert response.status_code == 200
    assert expected.read_text(encoding="utf-8") == "external archive entry\n"
    archived_path = Path(response.json()["path"])
    assert archived_path != expected
    assert archived_path.parent == expected.parent
    assert parse_note(archived_path).id == "thr_bbb222"


@pytest.mark.asyncio
async def test_archive_waits_for_shared_note_lock(
    seeded_vault: Path,
    note_index,
) -> None:
    path = note_index.get_path_by_id("thr_ccc333")
    assert path is not None

    async with path_lock(path):
        archive_task = asyncio.create_task(
            notes_routes._archive_note_transaction(
                path=path,
                note_id="thr_ccc333",
                base_modified=None,
                vault_root=seeded_vault,
                threads_dir=seeded_vault / "threads",
                index=note_index,
            )
        )
        await asyncio.sleep(0)
        assert not archive_task.done()

    result = await archive_task
    assert result["status"] == "archived"
    assert not path.exists()


# -- Tree endpoint ------------------------------------------------------------


def test_get_tree(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/tree")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_dir"] is True
    # Should have child directories
    child_names = [c["name"] for c in data["children"]]
    assert "topics" in child_names
    assert "projects" in child_names


# -- Graph endpoint -----------------------------------------------------------


def test_get_graph(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/graph")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["nodes"]) == 3
    assert len(data["edges"]) == 4


def test_get_graph_filter_type(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/graph?type=project")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["nodes"]) == 1
    assert data["nodes"][0]["type"] == "project"
    assert len(data["edges"]) == 0  # no edges between single-node subgraph


def test_get_graph_filter_tag(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/graph?tag=lang")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["nodes"]) == 1
    assert data["nodes"][0]["id"] == "thr_aaa111"

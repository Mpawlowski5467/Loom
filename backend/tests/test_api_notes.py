"""Tests for the notes, tree, and graph API routes."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

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

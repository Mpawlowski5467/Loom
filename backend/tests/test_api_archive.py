"""Tests for the archive (trash) list + restore API routes."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from core.notes import note_to_file_content
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
        "## About\n\nA language.\n",
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
        "## About\n\nThis project.\n",
    ),
]


@pytest.fixture()
def seeded_vault(vault_manager, note_index):
    """Create a vault with a couple of test notes and a built index."""
    return _seed_notes(vault_manager, note_index, _NOTES)


def _archive(client: TestClient, note_id: str) -> None:
    """Archive a note via the notes endpoint (the path users actually take)."""
    resp = client.delete(f"/api/notes/{note_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "archived"


# -- List ---------------------------------------------------------------------


def test_list_archived_empty(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/archive")
    assert resp.status_code == 200
    assert resp.json()["notes"] == []


def test_list_archived_after_archiving(client: TestClient, seeded_vault: Path) -> None:
    _archive(client, "thr_aaa111")

    resp = client.get("/api/archive")
    assert resp.status_code == 200
    notes = resp.json()["notes"]
    assert len(notes) == 1

    entry = notes[0]
    assert entry["id"] == "thr_aaa111"
    assert entry["title"] == "Python"
    assert entry["type"] == "topic"
    # Flattened archive: original folder recovered from the note type.
    assert entry["original_path"] == "topics/python.md"
    assert entry["archived_at"]  # stamped from the archive history entry

    # The archived note is no longer in the active listing.
    active_ids = [n["id"] for n in client.get("/api/notes").json()["notes"]]
    assert "thr_aaa111" not in active_ids


# -- Restore: happy path ------------------------------------------------------


def test_restore_happy_path(client: TestClient, seeded_vault: Path) -> None:
    _archive(client, "thr_aaa111")

    resp = client.post("/api/archive/thr_aaa111/restore")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "thr_aaa111"
    assert data["status"] == "active"
    # A restore history entry was appended.
    assert any(h["action"] == "restored" and h["by"] == "user" for h in data["history"])

    # The file is back in its original folder.
    restored = Path(seeded_vault) / "threads" / "topics" / "python.md"
    assert restored.exists()
    assert data["file_path"] == str(restored)

    # It's gone from the archive...
    assert client.get("/api/archive").json()["notes"] == []
    # ...and findable again in the index / active listing / graph.
    assert client.get("/api/notes/thr_aaa111").status_code == 200
    assert "thr_aaa111" in [n["id"] for n in client.get("/api/notes").json()["notes"]]
    graph_ids = [n["id"] for n in client.get("/api/graph").json()["nodes"]]
    assert "thr_aaa111" in graph_ids


def test_restore_preserves_tree_archived_folder(client: TestClient, seeded_vault: Path) -> None:
    """A note archived via the tree endpoint keeps its original sub-path."""
    resp = client.delete("/api/tree/path/projects/loom.md")
    assert resp.status_code == 200

    listed = client.get("/api/archive").json()["notes"]
    assert listed == [n for n in listed if n["id"] == "thr_ccc333"]
    assert listed[0]["original_path"] == "projects/loom.md"

    restore = client.post("/api/archive/thr_ccc333/restore")
    assert restore.status_code == 200
    assert (Path(seeded_vault) / "threads" / "projects" / "loom.md").exists()


# -- Restore: collision -------------------------------------------------------


def test_restore_path_occupied(client: TestClient, seeded_vault: Path) -> None:
    """Restoring onto an occupied original path fails clearly, clobbering nothing."""
    _archive(client, "thr_aaa111")

    # A new, different active note now occupies topics/python.md.
    occupant_meta = {
        "id": "thr_new999",
        "title": "Python",
        "type": "topic",
        "tags": [],
        "created": "2026-02-02T00:00:00+00:00",
        "modified": "2026-02-02T00:00:00+00:00",
        "author": "user",
        "status": "active",
        "history": [],
    }
    occupant = Path(seeded_vault) / "threads" / "topics" / "python.md"
    occupant.write_text(note_to_file_content(occupant_meta, "## Other\n\nUnrelated.\n"))

    resp = client.post("/api/archive/thr_aaa111/restore")
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # The occupant is untouched and the archived copy is still archived.
    assert "thr_new999" in occupant.read_text()
    assert len(client.get("/api/archive").json()["notes"]) == 1


# -- Restore: not found -------------------------------------------------------


def test_restore_missing_archive_id(client: TestClient, seeded_vault: Path) -> None:
    resp = client.post("/api/archive/thr_zzzzzz/restore")
    assert resp.status_code == 404

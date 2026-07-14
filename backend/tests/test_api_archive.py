"""Tests for the archive (trash) list + restore API routes."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

import api.routers.archive as archive_routes
from core.archive_paths import ARCHIVE_ORIGINAL_PATH_FIELD
from core.notes import note_to_file_content, parse_note
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


def test_note_archive_restore_preserves_nested_custom_folder(
    client: TestClient,
    seeded_vault: Path,
    note_index,
) -> None:
    """Note-level archive round-trips the exact custom folder, not its type folder."""
    rel = Path("custom") / "clients" / "acme" / "brief.md"
    source = seeded_vault / "threads" / rel
    source.parent.mkdir(parents=True)
    source.write_text(
        note_to_file_content(
            {
                "id": "thr_custom1",
                "title": "Acme Brief",
                # A type-derived restore would incorrectly choose topics/.
                "type": "topic",
                "tags": [],
                "created": "2026-03-03T00:00:00+00:00",
                "modified": "2026-03-03T00:00:00+00:00",
                "author": "user",
                "status": "active",
                "history": [],
            },
            "Nested custom content.\n",
        ),
        encoding="utf-8",
    )
    note_index.refresh_file(source)

    archived_response = client.delete("/api/notes/thr_custom1")
    assert archived_response.status_code == 200
    archived = Path(archived_response.json()["path"])
    assert archived == seeded_vault / "threads" / ".archive" / rel
    assert parse_note(archived).extra[ARCHIVE_ORIGINAL_PATH_FIELD] == rel.as_posix()

    listed = client.get("/api/archive")
    assert listed.status_code == 200
    custom_entry = next(n for n in listed.json()["notes"] if n["id"] == "thr_custom1")
    assert custom_entry["original_path"] == rel.as_posix()

    restored_response = client.post("/api/archive/thr_custom1/restore")
    assert restored_response.status_code == 200
    assert source.exists()
    assert not archived.exists()
    restored = parse_note(source)
    assert restored.body == "Nested custom content.\n"
    assert ARCHIVE_ORIGINAL_PATH_FIELD not in restored.extra
    assert not (seeded_vault / "threads" / "topics" / "brief.md").exists()


def test_restore_legacy_flat_archive_uses_type_folder(
    client: TestClient,
    seeded_vault: Path,
    note_index,
) -> None:
    """Pre-path-metadata flat archives remain restorable."""
    source = seeded_vault / "threads" / "topics" / "python.md"
    archive = seeded_vault / "threads" / ".archive"
    archive.mkdir(exist_ok=True)
    legacy = archive / "python.md"
    source.rename(legacy)
    note_index.remove_file(source)

    listed = client.get("/api/archive")
    assert listed.status_code == 200
    assert listed.json()["notes"][0]["original_path"] == "topics/python.md"

    restored = client.post("/api/archive/thr_aaa111/restore")
    assert restored.status_code == 200
    assert source.exists()
    assert not legacy.exists()


def test_restore_unlink_failure_rolls_back_live_copy(
    client: TestClient,
    seeded_vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The archive remains authoritative if restore cannot remove it."""
    _archive(client, "thr_aaa111")
    archive_file = seeded_vault / "threads" / ".archive" / "topics" / "python.md"
    restored_file = seeded_vault / "threads" / "topics" / "python.md"

    def fail_remove(path: Path) -> None:  # noqa: ARG001
        raise OSError("injected archive unlink failure")

    monkeypatch.setattr(archive_routes, "_remove_archive_file", fail_remove)
    response = client.post("/api/archive/thr_aaa111/restore")

    assert response.status_code == 500
    assert archive_file.exists()
    assert not restored_file.exists()


def test_restore_exclusive_create_preserves_racing_destination(
    client: TestClient,
    seeded_vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A destination created after the initial check is never overwritten."""
    _archive(client, "thr_aaa111")
    destination = seeded_vault / "threads" / "topics" / "python.md"
    archived = seeded_vault / "threads" / ".archive" / "topics" / "python.md"
    real_write = archive_routes.vault_write_note_exclusive

    def race_write(vault_root: Path, path: Path, meta: dict, body: str) -> tuple[int, int]:
        path.write_text("external writer won\n", encoding="utf-8")
        return real_write(vault_root, path, meta, body)

    monkeypatch.setattr(archive_routes, "vault_write_note_exclusive", race_write)
    response = client.post("/api/archive/thr_aaa111/restore")

    assert response.status_code == 409
    assert destination.read_text(encoding="utf-8") == "external writer won\n"
    assert archived.exists()


def test_restore_rejects_tampered_traversal_metadata(
    client: TestClient,
    seeded_vault: Path,
) -> None:
    """An edited archive record cannot restore outside threads/."""
    _archive(client, "thr_aaa111")
    archived_path = seeded_vault / "threads" / ".archive" / "topics" / "python.md"
    archived = parse_note(archived_path)
    meta = archived.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta[ARCHIVE_ORIGINAL_PATH_FIELD] = "../../escaped.md"
    archived_path.write_text(note_to_file_content(meta, archived.body), encoding="utf-8")

    response = client.post("/api/archive/thr_aaa111/restore")

    assert response.status_code == 400
    assert archived_path.exists()
    assert not (seeded_vault / "escaped.md").exists()


def test_restore_rejects_symlinked_destination_parent(
    client: TestClient,
    seeded_vault: Path,
) -> None:
    """A symlinked custom folder cannot redirect a restore outside the vault."""
    _archive(client, "thr_aaa111")
    archived_path = seeded_vault / "threads" / ".archive" / "topics" / "python.md"
    archived = parse_note(archived_path)
    meta = archived.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta[ARCHIVE_ORIGINAL_PATH_FIELD] = "linked/python.md"
    archived_path.write_text(note_to_file_content(meta, archived.body), encoding="utf-8")

    outside = seeded_vault.parent / "outside"
    outside.mkdir()
    (seeded_vault / "threads" / "linked").symlink_to(outside, target_is_directory=True)

    response = client.post("/api/archive/thr_aaa111/restore")

    assert response.status_code == 400
    assert archived_path.exists()
    assert not (outside / "python.md").exists()


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

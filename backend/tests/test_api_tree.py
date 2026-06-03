"""Tests for the file-tree mutation routes (folder create, move, …)."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from core.notes import note_to_file_content


@pytest.fixture()
def active_vault(vault_manager) -> Path:
    """Initialize an empty vault and make it active."""
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    return vault_manager.active_threads_dir()


def _write_note(folder: Path, name: str, note_id: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    meta = {
        "id": note_id,
        "title": name.replace(".md", "").replace("-", " ").title(),
        "type": "topic",
        "tags": [],
        "created": "2026-01-01T00:00:00+00:00",
        "modified": "2026-01-01T00:00:00+00:00",
        "author": "user",
        "status": "active",
        "history": [],
    }
    path = folder / name
    path.write_text(note_to_file_content(meta, "## Body\n"))
    return path


# -- POST /api/tree/folder ----------------------------------------------------


def test_create_folder_happy_path(client: TestClient, active_vault: Path) -> None:
    resp = client.post("/api/tree/folder", json={"path": "research"})
    assert resp.status_code == 201
    assert (active_vault / "research").is_dir()
    data = resp.json()
    assert data["name"] == "research"
    assert data["is_dir"] is True


def test_create_folder_nested(client: TestClient, active_vault: Path) -> None:
    resp = client.post("/api/tree/folder", json={"path": "topics/python"})
    assert resp.status_code == 201
    assert (active_vault / "topics" / "python").is_dir()


def test_create_folder_rejects_traversal(client: TestClient, active_vault: Path) -> None:
    resp = client.post("/api/tree/folder", json={"path": "../outside"})
    assert resp.status_code == 400
    # Ensure no folder was created at the parent level.
    assert not (active_vault.parent / "outside").exists()


def test_create_folder_rejects_absolute(client: TestClient, active_vault: Path) -> None:
    resp = client.post("/api/tree/folder", json={"path": "/etc/passwd"})
    assert resp.status_code == 400


def test_create_folder_rejects_hidden(client: TestClient, active_vault: Path) -> None:
    resp = client.post("/api/tree/folder", json={"path": ".secret"})
    assert resp.status_code == 400


def test_create_folder_rejects_empty(client: TestClient, active_vault: Path) -> None:
    resp = client.post("/api/tree/folder", json={"path": ""})
    assert resp.status_code == 400


def test_create_folder_conflict(client: TestClient, active_vault: Path) -> None:
    (active_vault / "topics").mkdir(parents=True, exist_ok=True)
    resp = client.post("/api/tree/folder", json={"path": "topics"})
    assert resp.status_code == 409


# -- POST /api/tree/move ------------------------------------------------------


def test_move_file_between_folders(client: TestClient, active_vault: Path, note_index) -> None:
    src = _write_note(active_vault / "topics", "python.md", "thr_aaa111")
    note_index.refresh_file(src)
    resp = client.post(
        "/api/tree/move",
        json={"from": "topics/python.md", "to": "projects/python.md"},
    )
    assert resp.status_code == 200
    assert not src.exists()
    assert (active_vault / "projects" / "python.md").exists()


def test_move_folder_into_folder(client: TestClient, active_vault: Path) -> None:
    (active_vault / "research").mkdir()
    resp = client.post(
        "/api/tree/move",
        json={"from": "research", "to": "topics/research"},
    )
    assert resp.status_code == 200
    assert (active_vault / "topics" / "research").is_dir()
    assert not (active_vault / "research").exists()


def test_move_rejects_traversal(client: TestClient, active_vault: Path) -> None:
    (active_vault / "topics").mkdir(exist_ok=True)
    resp = client.post(
        "/api/tree/move",
        json={"from": "topics", "to": "../escaped"},
    )
    assert resp.status_code == 400


def test_move_missing_source(client: TestClient, active_vault: Path) -> None:
    resp = client.post(
        "/api/tree/move",
        json={"from": "topics/missing.md", "to": "projects/missing.md"},
    )
    assert resp.status_code == 404


def test_move_conflict(client: TestClient, active_vault: Path) -> None:
    _write_note(active_vault / "topics", "foo.md", "thr_a")
    _write_note(active_vault / "projects", "foo.md", "thr_b")
    resp = client.post(
        "/api/tree/move",
        json={"from": "topics/foo.md", "to": "projects/foo.md"},
    )
    assert resp.status_code == 409


# -- PATCH /api/tree/rename ---------------------------------------------------


def test_rename_file_preserves_suffix(client: TestClient, active_vault: Path, note_index) -> None:
    src = _write_note(active_vault / "topics", "python.md", "thr_aaa111")
    note_index.refresh_file(src)
    resp = client.patch(
        "/api/tree/rename",
        json={"path": "topics/python.md", "new_name": "py3"},
    )
    assert resp.status_code == 200
    assert (active_vault / "topics" / "py3.md").exists()
    assert not src.exists()


def test_rename_folder(client: TestClient, active_vault: Path) -> None:
    (active_vault / "research").mkdir()
    resp = client.patch(
        "/api/tree/rename",
        json={"path": "research", "new_name": "studies"},
    )
    assert resp.status_code == 200
    assert (active_vault / "studies").is_dir()


def test_rename_core_folder_rejected(client: TestClient, active_vault: Path) -> None:
    (active_vault / "topics").mkdir(exist_ok=True)
    resp = client.patch(
        "/api/tree/rename",
        json={"path": "topics", "new_name": "subjects"},
    )
    assert resp.status_code == 400


def test_rename_invalid_name(client: TestClient, active_vault: Path) -> None:
    (active_vault / "research").mkdir()
    resp = client.patch(
        "/api/tree/rename",
        json={"path": "research", "new_name": "../bad"},
    )
    assert resp.status_code == 400


# -- DELETE /api/tree/path/{rel_path:path} ------------------------------------


def test_archive_file(client: TestClient, active_vault: Path, note_index) -> None:
    src = _write_note(active_vault / "topics", "scratch.md", "thr_xxx")
    note_index.refresh_file(src)
    resp = client.delete("/api/tree/path/topics/scratch.md")
    assert resp.status_code == 200
    assert not src.exists()
    assert (active_vault / ".archive" / "topics" / "scratch.md").exists()


def test_archive_folder(client: TestClient, active_vault: Path) -> None:
    (active_vault / "research").mkdir()
    _write_note(active_vault / "research", "a.md", "thr_a")
    resp = client.delete("/api/tree/path/research")
    assert resp.status_code == 200
    assert not (active_vault / "research").exists()
    assert (active_vault / ".archive" / "research" / "a.md").exists()


def test_archive_core_folder_rejected(client: TestClient, active_vault: Path) -> None:
    (active_vault / "topics").mkdir(exist_ok=True)
    resp = client.delete("/api/tree/path/topics")
    assert resp.status_code == 400


def test_hard_delete_file(client: TestClient, active_vault: Path, note_index) -> None:
    src = _write_note(active_vault / "topics", "doomed.md", "thr_d")
    note_index.refresh_file(src)
    resp = client.delete("/api/tree/path/topics/doomed.md?hard=true")
    assert resp.status_code == 200
    assert not src.exists()
    assert not (active_vault / ".archive" / "topics" / "doomed.md").exists()

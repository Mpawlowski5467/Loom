from pathlib import Path
from unittest.mock import patch

import pytest

from core import revisions
from core.notes import note_to_file_content, parse_note
from core.traces import clear_run, set_run
from core.vault_io import write_note
from tests.conftest import _seed_notes


def _note(note_id: str, body: str) -> str:
    return note_to_file_content(
        {"id": note_id, "title": note_id, "type": "topic", "history": []}, body
    )


def _write(root: Path, relative: str, note_id: str, body: str) -> Path:
    path = root / "threads" / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    write_note(root, path, {"id": note_id, "title": note_id, "type": "topic", "history": []}, body)
    return path


def test_run_undo_restores_every_note_link_and_archived_capture(tmp_path):
    root = tmp_path
    original = _write(root, "topics/existing.md", "old", "Original")
    capture = _write(root, "captures/input.md", "capture", "Source")
    before_old, before_capture = original.read_text(), capture.read_text()
    set_run("run-complete")
    try:
        created = _write(root, "projects/new.md", "new", "Filed")
        _write(root, "topics/existing.md", "old", "Original [[new]]")
        archived = root / "threads/.archive/input.md"
        archived.parent.mkdir(parents=True)
        revisions.record_move(root, capture, archived)
    finally:
        clear_run()
    change = revisions.run_changes(root, "run-complete")
    view = revisions.preview(root, change)
    assert len(view["files"]) == 4
    revisions.undo(root, change, {f["path"]: f["current_hash"] for f in view["files"]})
    assert original.read_text() == before_old
    assert capture.read_text() == before_capture
    assert not created.exists()
    assert not archived.exists()
    assert any(parse_note(p).id == "new" for p in (root / "threads/.archive").rglob("*.md"))
    saved = next(parse_note(p) for p in (root / "threads/.archive").rglob("*.md"))
    assert saved.extra["archive_original_path"] == "projects/new.md"


def test_undo_rejects_created_non_note_without_changing_bytes(tmp_path: Path) -> None:
    root = tmp_path
    path = root / "threads" / "topics" / "generated.md"
    path.parent.mkdir(parents=True)
    path.write_text("opaque generated data")
    change = {
        "run_id": "x",
        "before": {"topics/generated.md": None},
        "after": {"topics/generated.md": "opaque generated data"},
    }
    before = path.read_bytes()
    with pytest.raises(revisions.RevisionConflict, match="non-note"):
        revisions.undo(
            root, change, {"topics/generated.md": revisions.fingerprint("opaque generated data")}
        )
    assert path.read_bytes() == before


def test_run_undo_conflict_changes_nothing(tmp_path):
    path = _write(tmp_path, "topics/a.md", "a", "before")
    set_run("run-conflict")
    try:
        other = _write(tmp_path, "topics/b.md", "b", "new")
        _write(tmp_path, "topics/a.md", "a", "agent")
    finally:
        clear_run()
    change = revisions.run_changes(tmp_path, "run-conflict")
    view = revisions.preview(tmp_path, change)
    path.write_text(_note("a", "external"))
    with pytest.raises(revisions.RevisionConflict):
        revisions.undo(tmp_path, change, {f["path"]: f["current_hash"] for f in view["files"]})
    assert "external" in path.read_text()
    assert other.exists()


def test_partial_batch_failure_rolls_back_and_journal_remains(tmp_path):
    a = _write(tmp_path, "topics/a.md", "a", "before-a")
    b = _write(tmp_path, "topics/b.md", "b", "before-b")
    original_a, original_b = a.read_text(), b.read_text()

    def fail():
        a.write_text(_note("a", "after-a"))
        raise OSError("disk unavailable")

    with pytest.raises(OSError, match="disk unavailable"):
        revisions.record_mutation(
            tmp_path, {a: _note("a", "after-a"), b: _note("b", "after-b")}, fail
        )
    assert a.read_text() == original_a
    assert b.read_text() == original_b
    revisions.recover(tmp_path)


def test_interrupted_batch_preserves_external_edit(tmp_path):
    a = _write(tmp_path, "topics/a.md", "a", "before")
    # Simulate a crash after journaling and before completion.
    with revisions._db(tmp_path) as conn:
        import json

        conn.execute(
            "INSERT INTO revisions(id,run_id,caller,created,state,before_json,after_json) VALUES(?,?,?,?,?,?,?)",
            (
                "interrupted",
                "",
                "user",
                "now",
                "prepared",
                json.dumps({"topics/a.md": a.read_text()}),
                json.dumps({"topics/a.md": _note("a", "after")}),
            ),
        )
        conn.commit()
    a.write_text("Unrelated external edit")
    with pytest.raises(revisions.RevisionConflict, match="external edit"):
        revisions.recover(tmp_path)
    assert a.read_text() == "Unrelated external edit"


def test_revision_api_restore_uses_preview_hash(client, vault_manager, note_index):
    root = _seed_notes(
        vault_manager,
        note_index,
        [
            (
                "topics",
                "a.md",
                {"id": "a", "title": "A", "type": "topic", "modified": "old", "history": []},
                "Original",
            )
        ],
    )
    with patch("agents.loom.weaver.get_weaver", return_value=None):
        assert (
            client.put("/api/notes/a", json={"body": "Updated", "base_modified": "old"}).status_code
            == 200
        )
    items = client.get("/api/revisions?note_id=a").json()
    revision_id = items[0]["id"]
    detail = client.get(f"/api/revisions/{revision_id}?note_id=a").json()
    path = root / "threads/topics/a.md"
    response = client.post(
        f"/api/revisions/{revision_id}/restore",
        json={"note_id": "a", "expected_hash": detail["current_hash"]},
    )
    assert response.status_code == 200, response.text
    assert parse_note(path).body == "Original"
    assert parse_note(path).history[-1].action == "restored"
    # Reusing the old preview must reject, even if modified timestamps collide.
    assert (
        client.post(
            f"/api/revisions/{revision_id}/restore",
            json={"note_id": "a", "expected_hash": detail["current_hash"]},
        ).status_code
        == 409
    )


def test_revision_write_rejects_path_escape(tmp_path):
    outside = tmp_path / "outside.md"
    with pytest.raises(ValueError):
        revisions.record_mutation(
            tmp_path, {outside: "unsafe"}, lambda: outside.write_text("unsafe")
        )
    assert not outside.exists()


def test_undo_created_note_can_be_restored_to_original_nested_folder(
    client, vault_manager, note_index
):
    root = _seed_notes(vault_manager, note_index, [])
    set_run("restore-after-undo")
    try:
        path = _write(root, "projects/nested/new.md", "recoverable", "Keep every word")
    finally:
        clear_run()
    note_index.refresh_file(path)
    view = client.get("/api/revisions/runs/restore-after-undo").json()
    result = client.post(
        "/api/revisions/runs/restore-after-undo/undo",
        json={"expected_hashes": {item["path"]: item["current_hash"] for item in view["files"]}},
    )
    assert result.status_code == 200, result.text
    archive = client.get("/api/archive").json()["notes"]
    assert archive[0]["original_path"] == "projects/nested/new.md"
    restored = client.post("/api/archive/recoverable/restore")
    assert restored.status_code == 200, restored.text
    assert path.exists() and parse_note(path).body == "Keep every word"

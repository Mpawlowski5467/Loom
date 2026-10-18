from pathlib import Path
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from core.capture_jobs import capture_job_store
from core.notes import parse_note
from core.revisions import list_revisions
from tests.conftest import _seed_notes

CAPTURE = (
    "captures",
    "input.md",
    {
        "id": "cap_1",
        "title": "Input",
        "type": "capture",
        "tags": [],
        "created": "2026-01-01T00:00:00Z",
        "modified": "2026-01-01T00:00:00Z",
        "author": "you",
        "source": "manual",
        "status": "active",
        "history": [],
    },
    "Source body",
)
TARGET = (
    "topics",
    "target.md",
    {
        "id": "note_1",
        "title": "Target",
        "type": "topic",
        "tags": [],
        "created": "2026-01-01T00:00:00Z",
        "modified": "2026-01-02T00:00:00Z",
        "author": "you",
        "source": "manual",
        "status": "active",
        "history": [],
    },
    "Original target",
)


@pytest.fixture()
def review_vault(vault_manager, note_index) -> Path:
    return _seed_notes(vault_manager, note_index, [CAPTURE, TARGET])


def payload(base_modified: str = "2026-01-02T00:00:00Z") -> dict[str, str]:
    return {
        "capture_path": "captures/input.md",
        "target_note_id": "note_1",
        "body": "Merged full body",
        "base_modified": base_modified,
    }


def test_merge_writes_full_body_archives_source_and_completes_job(
    client: TestClient, review_vault: Path
) -> None:
    response = client.post("/api/capture-review/merge", json=payload())
    assert response.status_code == 200
    assert parse_note(review_vault / "threads/topics/target.md").body == "Merged full body"
    assert not (review_vault / "threads/captures/input.md").exists()
    archived = parse_note(review_vault / "threads/.archive/input.md")
    assert archived.id == "cap_1"
    assert archived.status == "archived"
    assert archived.extra["enforcement_outcome"] == "filed"
    assert archived.history[-1].action == "archived"
    assert archived.history[-1].reason == "Merged into note_1"
    assert list_revisions(review_vault, "cap_1")
    job = capture_job_store(review_vault).get_by_capture("cap_1")
    assert job is not None and job.status == "completed"


def test_stale_merge_changes_neither_target_nor_capture(
    client: TestClient, review_vault: Path
) -> None:
    target = review_vault / "threads/topics/target.md"
    capture = review_vault / "threads/captures/input.md"
    target_before, capture_before = target.read_text(), capture.read_text()
    response = client.post("/api/capture-review/merge", json=payload("stale"))
    assert response.status_code == 409
    assert target.read_text() == target_before and capture.read_text() == capture_before


def test_archive_failure_restores_target_and_keeps_capture_retryable(
    client: TestClient, review_vault: Path
) -> None:
    target = review_vault / "threads/topics/target.md"
    capture = review_vault / "threads/captures/input.md"
    target_before, capture_before = target.read_text(), capture.read_text()
    with patch("core.capture_lifecycle.record_move", side_effect=OSError("archive failed")):
        response = client.post("/api/capture-review/merge", json=payload())
    assert response.status_code == 500
    assert target.read_text() == target_before and capture.read_text() == capture_before
    job = capture_job_store(review_vault).get_by_capture("cap_1")
    assert job is not None and job.status == "failed"


def test_self_target_rejected_without_waiting_on_path_lock(
    client: TestClient, review_vault: Path
) -> None:
    response = client.post(
        "/api/capture-review/merge", json={**payload(), "target_note_id": "cap_1"}
    )
    assert response.status_code == 400

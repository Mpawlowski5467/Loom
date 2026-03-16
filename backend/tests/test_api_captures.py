"""Tests for the captures API routes in api/routers/captures.py."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from tests.conftest import _seed_notes

_CAPTURE_NOTES = [
    (
        "captures",
        "raw-idea.md",
        {
            "id": "thr_cap001",
            "title": "Raw Idea",
            "type": "capture",
            "tags": ["idea"],
            "created": "2026-03-15T08:00:00+00:00",
            "modified": "2026-03-15T08:00:00+00:00",
            "author": "user",
            "source": "manual",
            "status": "active",
            "history": [],
        },
        "## Idea\n\nA cool new feature.\n",
    ),
    (
        "captures",
        "research-snippet.md",
        {
            "id": "thr_cap002",
            "title": "Research Snippet",
            "type": "capture",
            "tags": ["research"],
            "created": "2026-03-15T09:00:00+00:00",
            "modified": "2026-03-15T09:00:00+00:00",
            "author": "agent:researcher",
            "source": "capture:ext",
            "status": "active",
            "history": [],
        },
        "## Research\n\nFindings about distributed systems.\n",
    ),
]


@pytest.fixture()
def seeded_captures(vault_manager, note_index):
    """Create a vault with capture notes."""
    return _seed_notes(vault_manager, note_index, _CAPTURE_NOTES)


@pytest.fixture()
def empty_vault(vault_manager, note_index):
    """Create an empty vault (no notes seeded)."""
    return _seed_notes(vault_manager, note_index, [])


# ---------------------------------------------------------------------------
# GET /api/captures
# ---------------------------------------------------------------------------


class TestGetCaptures:
    def test_empty_captures_returns_empty_list(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        """GET /api/captures with no captures returns an empty list."""
        resp = client.get("/api/captures")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_lists_seeded_captures(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """GET /api/captures with seeded captures returns items with metadata."""
        resp = client.get("/api/captures")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

        ids = {item["id"] for item in data}
        assert "thr_cap001" in ids
        assert "thr_cap002" in ids

    def test_capture_item_has_expected_fields(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """Each capture item contains the expected fields."""
        resp = client.get("/api/captures")
        data = resp.json()
        item = next(i for i in data if i["id"] == "thr_cap001")

        assert item["title"] == "Raw Idea"
        assert item["type"] == "capture"
        assert item["tags"] == ["idea"]
        assert item["author"] == "user"
        assert item["status"] == "active"
        assert item["preview"]  # non-empty preview
        assert item["file_path"]  # non-empty file path

    def test_capture_preview_content(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """Preview text is extracted from the note body."""
        resp = client.get("/api/captures")
        data = resp.json()
        item = next(i for i in data if i["id"] == "thr_cap001")
        assert "Idea" in item["preview"] or "cool new feature" in item["preview"]


# ---------------------------------------------------------------------------
# POST /api/captures/process
# ---------------------------------------------------------------------------


class TestProcessCapture:
    def test_process_capture_weaver_not_initialized(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process when Weaver is None returns 503."""
        with patch("agents.loom.weaver.get_weaver", return_value=None):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 503
        assert "Weaver" in resp.json()["detail"]

    def test_process_capture_not_found(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process with nonexistent path returns 404."""
        mock_weaver = MagicMock()

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/nonexistent.md"},
            )

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"]

    def test_process_capture_success(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process with valid capture returns processed result."""
        mock_note = MagicMock()
        mock_note.id = "thr_new001"
        mock_note.title = "Processed Note"
        mock_note.type = "topic"
        mock_note.file_path = "/tmp/threads/topics/processed.md"

        mock_weaver = MagicMock()
        mock_weaver.process_capture = AsyncMock(return_value=mock_note)

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is True
        assert data["note_id"] == "thr_new001"
        assert data["note_title"] == "Processed Note"
        assert data["note_type"] == "topic"

    def test_process_capture_empty_returns_skipped(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process where weaver returns None means empty capture."""
        mock_weaver = MagicMock()
        mock_weaver.process_capture = AsyncMock(return_value=None)

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is False
        assert "Empty capture" in data["error"]

    def test_process_capture_weaver_exception(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process returns error when weaver raises."""
        mock_weaver = MagicMock()
        mock_weaver.process_capture = AsyncMock(
            side_effect=RuntimeError("LLM call failed")
        )

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is False
        assert "LLM call failed" in data["error"]


# ---------------------------------------------------------------------------
# POST /api/captures/process-all
# ---------------------------------------------------------------------------


class TestProcessAllCaptures:
    def test_process_all_weaver_not_initialized(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process-all when Weaver is None returns 503."""
        with patch("agents.loom.weaver.get_weaver", return_value=None):
            resp = client.post("/api/captures/process-all")

        assert resp.status_code == 503

    def test_process_all_empty_captures(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        """POST /api/captures/process-all with no captures returns zero total."""
        mock_weaver = MagicMock()

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post("/api/captures/process-all")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["processed"] == 0
        assert data["results"] == []

    def test_process_all_success(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process-all processes all captures."""
        mock_note = MagicMock()
        mock_note.id = "thr_batch01"
        mock_note.title = "Batch Note"
        mock_note.type = "topic"
        mock_note.file_path = "/tmp/threads/topics/batch.md"

        mock_weaver = MagicMock()
        mock_weaver.process_capture = AsyncMock(return_value=mock_note)

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post("/api/captures/process-all")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["processed"] == 2
        assert len(data["results"]) == 2
        assert all(r["processed"] for r in data["results"])

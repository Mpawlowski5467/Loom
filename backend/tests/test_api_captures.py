"""Tests for the captures API routes in api/routers/captures.py."""

import asyncio
import inspect
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

import api.routers.captures as captures_router
from agents.loom.sentinel import ValidationResult
from agents.loom.spider_models import LinkCandidate
from agents.loom.weaver import CaptureProposal
from core.capture_jobs import capture_job_store
from core.events import CAPTURE_CHANGED, CAPTURE_JOB_CHANGED, NOTE_CHANGED, get_event_hub
from core.notes import Note, parse_note
from core.vault_io import write_note as vault_write_note
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
    def test_empty_captures_returns_empty_list(self, client: TestClient, empty_vault: Path) -> None:
        """GET /api/captures with no captures returns an empty list."""
        resp = client.get("/api/captures")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_lists_seeded_captures(self, client: TestClient, seeded_captures: Path) -> None:
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
        assert "cool new feature" in item["body"]
        assert item["file_path"]  # non-empty file path

    def test_capture_preview_content(self, client: TestClient, seeded_captures: Path) -> None:
        """Preview text is extracted from the note body."""
        resp = client.get("/api/captures")
        data = resp.json()
        item = next(i for i in data if i["id"] == "thr_cap001")
        assert "Idea" in item["preview"] or "cool new feature" in item["preview"]

    def test_returns_durable_review_and_provenance_metadata(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """Custom gateway/enforcement frontmatter is projected into Inbox items."""
        path = seeded_captures / "threads" / "captures" / "raw-idea.md"
        note = parse_note(path)
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta.update(
            {
                "external_id": "clip-42",
                "provenance": {"url": "https://example.test/article", "adapter": "clipper"},
                "enforcement_outcome": "needs_review",
                "review_required": True,
                "review_reasons": ["Missing context"],
                "validation": "failed",
                "validation_mode": "deterministic",
                "validation_reasons": ["Missing context"],
                "draft_note_id": "thr_draft1",
                "draft_note_path": "/vault/threads/topics/draft.md",
            }
        )
        vault_write_note(seeded_captures, path, meta, note.body)

        item = next(i for i in client.get("/api/captures").json() if i["id"] == note.id)
        assert item["external_id"] == "clip-42"
        assert item["provenance"]["url"] == "https://example.test/article"
        assert item["enforcement_outcome"] == "needs_review"
        assert item["review_required"] is True
        assert item["review_reasons"] == ["Missing context"]
        assert item["validation"] == "failed"
        assert item["validation_mode"] == "deterministic"
        assert item["validation_reasons"] == ["Missing context"]
        assert item["draft_note_id"] == "thr_draft1"
        assert item["draft_note_path"] == "/vault/threads/topics/draft.md"


# ---------------------------------------------------------------------------
# POST /api/captures  (capture gateway)
# ---------------------------------------------------------------------------


class TestCreateCapture:
    def test_creates_valid_capture_with_provenance(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        resp = client.post(
            "/api/captures",
            json={
                "title": "A clipped article",
                "body": "## Content\n\nImportant passage.",
                "source": "browser-clipper",
                "tags": ["research", " research ", ""],
                "external_id": "https://example.test/articles/42",
                "provenance": {
                    "url": "https://example.test/articles/42",
                    "selected_text": "Important passage.",
                },
            },
        )

        assert resp.status_code == 201
        data = resp.json()
        assert data["created"] is True
        assert data["deduplicated"] is False
        assert data["capture"]["source"] == "browser-clipper"
        assert data["capture"]["tags"] == ["research"]
        assert data["capture"]["external_id"] == "https://example.test/articles/42"
        assert data["capture"]["provenance"]["selected_text"] == "Important passage."

        path = Path(data["capture"]["file_path"])
        assert path.parent == empty_vault / "threads" / "captures"
        note = parse_note(path)
        assert note.type == "capture"
        assert note.status == "active"
        assert note.body == "## Content\n\nImportant passage."
        assert note.extra["external_id"] == "https://example.test/articles/42"
        assert note.extra["provenance"]["url"] == "https://example.test/articles/42"
        assert note.history[-1].action == "created"

    def test_title_cannot_control_destination_path(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        resp = client.post(
            "/api/captures",
            json={"title": "../../outside\\also", "body": "safe"},
        )

        assert resp.status_code == 201
        path = Path(resp.json()["capture"]["file_path"])
        assert path.parent == empty_vault / "threads" / "captures"
        assert ".." not in path.name
        assert not (empty_vault.parent / "outside.md").exists()

    def test_retries_dedupe_by_source_and_external_id(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        payload = {
            "title": "First title",
            "body": "original body",
            "source": "bridge:gmail",
            "external_id": "message-123",
        }
        first = client.post("/api/captures", json=payload)
        retry = client.post(
            "/api/captures",
            json={**payload, "title": "Changed on retry", "body": "replacement"},
        )

        assert first.status_code == 201
        assert retry.status_code == 200
        assert retry.json()["created"] is False
        assert retry.json()["deduplicated"] is True
        assert retry.json()["capture"]["id"] == first.json()["capture"]["id"]
        assert retry.json()["capture"]["body"] == "original body"
        assert len(list((empty_vault / "threads" / "captures").glob("*.md"))) == 1

    def test_external_id_is_scoped_by_source(self, client: TestClient, empty_vault: Path) -> None:
        base = {"title": "Event", "body": "x", "external_id": "same-id"}
        one = client.post("/api/captures", json={**base, "source": "bridge:one"})
        two = client.post("/api/captures", json={**base, "source": "bridge:two"})

        assert one.status_code == 201
        assert two.status_code == 201
        assert one.json()["capture"]["id"] != two.json()["capture"]["id"]

    def test_external_key_is_scoped_to_active_vault(
        self, client: TestClient, empty_vault: Path, vault_manager
    ) -> None:
        payload = {
            "title": "Calendar event",
            "source": "calendar",
            "external_id": "event-7",
        }
        first = client.post("/api/captures", json=payload)
        assert first.status_code == 201

        vault_manager.init_vault("second")
        vault_manager.set_active_vault("second")
        second = client.post("/api/captures", json=payload)

        assert second.status_code == 201
        assert second.json()["deduplicated"] is False
        assert second.json()["capture"]["id"] != first.json()["capture"]["id"]

    def test_without_external_id_each_capture_is_new(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        payload = {"title": "Quick note", "body": "same"}
        first = client.post("/api/captures", json=payload)
        second = client.post("/api/captures", json=payload)

        assert first.status_code == second.status_code == 201
        assert first.json()["capture"]["id"] != second.json()["capture"]["id"]
        assert len(list((empty_vault / "threads" / "captures").glob("*.md"))) == 2

    def test_blank_title_is_rejected(self, client: TestClient, empty_vault: Path) -> None:
        resp = client.post("/api/captures", json={"title": "   ", "body": "x"})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/captures/skip
# ---------------------------------------------------------------------------


class TestSkipCapture:
    def test_skip_archives_with_history_and_preserves_provenance(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        created = client.post(
            "/api/captures",
            json={
                "title": "Not useful",
                "body": "raw",
                "source": "browser-clipper",
                "external_id": "clip-9",
                "provenance": {"url": "https://example.test/9"},
            },
        ).json()["capture"]

        resp = client.post(
            "/api/captures/skip",
            json={"capture_path": created["file_path"], "reason": "Duplicate material"},
        )

        assert resp.status_code == 200
        result = resp.json()
        assert result["outcome"] == "skipped"
        assert result["processed"] is False
        assert result["capture_archived"] is True
        assert client.get("/api/captures").json() == []

        archived = parse_note(Path(result["target_path"]))
        assert archived.status == "archived"
        assert archived.extra["enforcement_outcome"] == "skipped"
        assert archived.extra["external_id"] == "clip-9"
        assert archived.extra["provenance"]["url"] == "https://example.test/9"
        assert archived.history[-1].action == "skipped"
        assert archived.history[-1].reason == "Duplicate material"

    def test_retry_after_skip_dedupes_against_archive(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        payload = {
            "title": "One event",
            "source": "bridge:events",
            "external_id": "event-1",
        }
        first = client.post("/api/captures", json=payload).json()["capture"]
        client.post("/api/captures/skip", json={"capture_path": first["file_path"]})

        retry = client.post("/api/captures", json=payload)

        assert retry.status_code == 200
        assert retry.json()["deduplicated"] is True
        assert retry.json()["capture"]["id"] == first["id"]
        assert retry.json()["capture"]["status"] == "archived"
        assert retry.json()["capture"]["enforcement_outcome"] == "skipped"
        assert client.get("/api/captures").json() == []

    def test_skip_rejects_non_inbox_note(self, client: TestClient, seeded_captures: Path) -> None:
        topic = seeded_captures / "threads" / "topics" / "not-a-capture.md"
        topic.parent.mkdir(parents=True, exist_ok=True)
        topic.write_text("# Topic\n", encoding="utf-8")

        resp = client.post(
            "/api/captures/skip",
            json={"capture_path": str(topic)},
        )

        assert resp.status_code == 400
        assert topic.exists()

    def test_skip_missing_capture_returns_404(self, client: TestClient, empty_vault: Path) -> None:
        resp = client.post(
            "/api/captures/skip",
            json={"capture_path": "captures/missing.md"},
        )
        assert resp.status_code == 404

    def test_skip_never_overwrites_same_named_archive(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        first = client.post("/api/captures", json={"title": "Same title", "body": "first"}).json()[
            "capture"
        ]
        first_skip = client.post("/api/captures/skip", json={"capture_path": first["file_path"]})
        second = client.post(
            "/api/captures", json={"title": "Same title", "body": "second"}
        ).json()["capture"]
        second_skip = client.post("/api/captures/skip", json={"capture_path": second["file_path"]})

        assert first_skip.status_code == second_skip.status_code == 200
        archive_files = list((empty_vault / "threads" / ".archive").glob("same-title*.md"))
        assert len(archive_files) == 2
        assert {parse_note(path).body for path in archive_files} == {"first", "second"}

    def test_failed_archive_move_rolls_back_active_metadata(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        created = client.post(
            "/api/captures", json={"title": "Keep pending", "body": "content"}
        ).json()["capture"]
        path = Path(created["file_path"])

        with patch("api.routers.captures.shutil.move", side_effect=OSError("disk failure")):
            resp = client.post("/api/captures/skip", json={"capture_path": created["file_path"]})

        assert resp.status_code == 500
        assert path.exists()
        restored = parse_note(path)
        assert restored.status == "active"
        assert "enforcement_outcome" not in restored.extra
        assert all(entry.action != "skipped" for entry in restored.history)


# ---------------------------------------------------------------------------
# POST /api/captures/process
# ---------------------------------------------------------------------------


class TestCapturePathSafety:
    @pytest.mark.parametrize(
        ("endpoint", "payload"),
        [
            ("/api/captures/process", {}),
            ("/api/captures/preview", {}),
            (
                "/api/captures/commit",
                {
                    "note_type": "topic",
                    "folder": "topics",
                    "title": "Unsafe copy",
                    "tags": [],
                    "body": "body",
                },
            ),
        ],
    )
    def test_capture_routes_reject_ordinary_notes_outside_inbox(
        self,
        client: TestClient,
        empty_vault: Path,
        endpoint: str,
        payload: dict[str, object],
    ) -> None:
        topic = empty_vault / "threads" / "topics" / "keep-me.md"
        vault_write_note(
            empty_vault,
            topic,
            {
                "id": "thr_topic1",
                "title": "Keep me",
                "type": "topic",
                "tags": [],
                "created": "2026-03-15T08:00:00+00:00",
                "modified": "2026-03-15T08:00:00+00:00",
                "author": "user",
                "source": "manual",
                "status": "active",
                "history": [],
            },
            "Important topic body",
        )

        response = client.post(
            endpoint,
            json={"capture_path": str(topic), **payload},
        )

        assert response.status_code == 400
        assert topic.exists()
        assert parse_note(topic).body == "Important topic body"

    def test_capture_routes_reject_non_capture_file_inside_inbox(
        self, client: TestClient, empty_vault: Path
    ) -> None:
        wrong_type = empty_vault / "threads" / "captures" / "topic.md"
        vault_write_note(
            empty_vault,
            wrong_type,
            {
                "id": "thr_wrong1",
                "title": "Wrong type",
                "type": "topic",
                "status": "active",
            },
            "body",
        )

        response = client.post(
            "/api/captures/process",
            json={"capture_path": "captures/topic.md"},
        )

        assert response.status_code == 400
        assert wrong_type.exists()


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

    def test_process_capture_not_found(self, client: TestClient, seeded_captures: Path) -> None:
        """POST /api/captures/process with nonexistent path returns 404."""
        mock_weaver = MagicMock()

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/nonexistent.md"},
            )

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"]

    def test_process_capture_success(self, client: TestClient, seeded_captures: Path) -> None:
        """POST /api/captures/process with valid capture returns processed result."""
        mock_note = MagicMock()
        mock_note.id = "thr_new001"
        mock_note.title = "Processed Note"
        mock_note.type = "topic"
        mock_note.file_path = "/tmp/threads/topics/processed.md"

        mock_weaver = MagicMock()
        # Router calls process_capture_full(), which returns (note, chain).
        mock_weaver.process_capture_full = AsyncMock(
            return_value=(mock_note, SimpleNamespace(success=True))
        )
        mock_sentinel = MagicMock()
        mock_sentinel.validate_action = AsyncMock(
            return_value=ValidationResult(status="passed", modes=["deterministic"])
        )

        hub = get_event_hub()
        event_queue = hub.subscribe()
        try:
            with (
                patch("agents.loom.weaver.get_weaver", return_value=mock_weaver),
                patch("agents.loom.sentinel.get_sentinel", return_value=mock_sentinel),
                patch("agents.loom.spider.get_spider", return_value=None),
                patch("agents.loom.scribe.get_scribe", return_value=None),
            ):
                resp = client.post(
                    "/api/captures/process",
                    json={"capture_path": "captures/raw-idea.md"},
                )
            events: list[str] = []
            while not event_queue.empty():
                events.append(event_queue.get_nowait())
        finally:
            hub.unsubscribe(event_queue)

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is True
        assert data["outcome"] == "filed"
        assert data["note_id"] == "thr_new001"
        assert data["note_title"] == "Processed Note"
        assert data["note_type"] == "topic"
        assert data["validation"] == "passed"
        assert data["capture_archived"] is True
        assert events == [
            CAPTURE_JOB_CHANGED,
            CAPTURE_CHANGED,
            NOTE_CHANGED,
            CAPTURE_JOB_CHANGED,
        ]

    def test_process_capture_empty_returns_failed_and_stays_pending(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """An empty capture is not called skipped unless it was durably archived."""
        mock_weaver = MagicMock()
        mock_weaver.process_capture_full = AsyncMock(return_value=(None, None))

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is False
        assert data["outcome"] == "failed"
        assert data["capture_archived"] is False
        assert data["error"] == "Empty capture cannot be processed"
        assert (seeded_captures / "threads" / "captures" / "raw-idea.md").exists()
        item = next(
            item for item in client.get("/api/captures").json() if item["id"] == "thr_cap001"
        )
        assert item["enforcement_outcome"] == "failed"
        assert item["last_attempt_outcome"] == "failed"
        assert item["last_error"] == "Empty capture cannot be processed"
        assert item["last_attempt_at"]

    def test_process_capture_weaver_exception(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """POST /api/captures/process returns error when weaver raises."""
        mock_weaver = MagicMock()
        mock_weaver.process_capture_full = AsyncMock(side_effect=RuntimeError("LLM call failed"))

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is False
        assert data["outcome"] == "failed"
        assert "LLM call failed" in data["error"]

    def test_failed_validation_is_needs_review_not_processed(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """A created draft with a failed Sentinel verdict is not reported as filed."""
        mock_note = MagicMock()
        mock_note.id = "thr_review01"
        mock_note.title = "Review Draft"
        mock_note.type = "topic"
        mock_note.file_path = str(seeded_captures / "threads" / "topics" / "review.md")

        mock_weaver = MagicMock()
        mock_weaver.process_capture_full = AsyncMock(
            return_value=(mock_note, SimpleNamespace(success=True))
        )
        mock_sentinel = MagicMock()
        mock_sentinel.validate_action = AsyncMock(
            return_value=ValidationResult(
                status="failed",
                reasons=["Summary is missing"],
                modes=["deterministic"],
            )
        )

        with (
            patch("agents.loom.weaver.get_weaver", return_value=mock_weaver),
            patch("agents.loom.sentinel.get_sentinel", return_value=mock_sentinel),
        ):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is False
        assert data["outcome"] == "needs_review"
        assert data["review_required"] is True
        assert data["capture_archived"] is False
        assert data["validation"] == "failed"
        assert data["validation_reasons"] == ["Summary is missing"]

        # The item remains in Inbox and the reason survives a fresh GET.
        item = next(
            item for item in client.get("/api/captures").json() if item["id"] == "thr_cap001"
        )
        assert item["enforcement_outcome"] == "needs_review"
        assert item["review_required"] is True
        assert item["review_reasons"] == ["Summary is missing"]
        assert item["validation"] == "failed"
        assert item["validation_reasons"] == ["Summary is missing"]

    def test_process_capture_pipeline_timeout_finalizes_job(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """A stalled pipeline is bounded server-side (issue #26).

        Uvicorn does not cancel the handler on client disconnect, so without
        the timeout a parked pipeline leaves the durable job in `running`
        indefinitely. With it, the job must be finalized as failed with a
        clear error.
        """
        import asyncio

        mock_runner = MagicMock()

        async def _stall(*args: object, **kwargs: object) -> None:
            await asyncio.sleep(60)

        mock_runner.run_pipeline = _stall

        with (
            patch("agents.loom.weaver.get_weaver", return_value=MagicMock()),
            patch("agents.runner.AgentRunner", return_value=mock_runner),
            patch("api.routers.captures._PROCESS_PIPELINE_TIMEOUT_S", 0.05),
        ):
            resp = client.post(
                "/api/captures/process",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["processed"] is False
        assert data["outcome"] == "failed"
        assert "timed out" in data["error"]

        jobs = client.get("/api/captures/jobs").json()
        job = next(j for j in jobs if j["capture_path"].endswith("raw-idea.md"))
        assert job["status"] == "failed"
        assert "timed out" in job["error"]


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

    def test_process_all_empty_captures(self, client: TestClient, empty_vault: Path) -> None:
        """POST /api/captures/process-all with no captures returns zero total."""
        mock_weaver = MagicMock()

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post("/api/captures/process-all")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["processed"] == 0
        assert data["results"] == []

    def test_process_all_success(self, client: TestClient, seeded_captures: Path) -> None:
        """POST /api/captures/process-all drives the full pipeline per capture."""
        mock_note = MagicMock()
        mock_note.id = "thr_batch01"
        mock_note.title = "Batch Note"
        mock_note.type = "topic"
        mock_note.file_path = "/tmp/threads/topics/batch.md"

        mock_result = MagicMock()
        mock_result.note = mock_note
        mock_result.errors = []
        mock_result.validation = None
        mock_result.links_added = []
        mock_result.suggested = []
        mock_result.capture_archived = True
        mock_result.review_required = False
        mock_result.flagged = False

        mock_runner = MagicMock()
        mock_runner.run_pipeline = AsyncMock(return_value=mock_result)

        # /process-all now runs the full capture pipeline (Weaver → Spider →
        # Scribe → Sentinel → enforce), so mock the runner, not Weaver alone.
        with (
            patch("agents.loom.weaver.get_weaver", return_value=MagicMock()),
            patch("agents.runner.AgentRunner", return_value=mock_runner),
        ):
            resp = client.post("/api/captures/process-all")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["processed"] == 2
        assert data["filed"] == 2
        assert data["needs_review"] == 0
        assert data["skipped"] == 0
        assert data["failed"] == 0
        assert len(data["results"]) == 2
        assert all(r["processed"] for r in data["results"])
        assert all(r["outcome"] == "filed" for r in data["results"])
        assert mock_runner.run_pipeline.await_count == 2

    def test_process_all_stalled_capture_fails_but_batch_continues(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """A stalled pipeline is bounded per capture, not per batch (#26 parity)."""
        import asyncio

        mock_runner = MagicMock()

        async def _stall(*args: object, **kwargs: object) -> None:
            await asyncio.sleep(60)

        mock_runner.run_pipeline = _stall

        with (
            patch("agents.loom.weaver.get_weaver", return_value=MagicMock()),
            patch("agents.runner.AgentRunner", return_value=mock_runner),
            patch("api.routers.captures._PROCESS_PIPELINE_TIMEOUT_S", 0.05),
        ):
            resp = client.post("/api/captures/process-all")

        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == data["total"]
        assert all("timed out" in r["error"] for r in data["results"])

    def test_process_all_counts_review_outcome_separately(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        filed_note = MagicMock(
            id="thr_filed",
            title="Filed",
            type="topic",
            file_path="/tmp/filed.md",
        )
        review_note = MagicMock(
            id="thr_review",
            title="Review",
            type="topic",
            file_path="/tmp/review.md",
        )
        filed = SimpleNamespace(
            note=filed_note,
            errors=[],
            validation=ValidationResult(status="passed", modes=["deterministic"]),
            links_added=[],
            suggested=[],
            capture_archived=True,
            review_required=False,
            flagged=False,
        )
        review = SimpleNamespace(
            note=review_note,
            errors=[],
            validation=ValidationResult(
                status="failed", reasons=["Needs context"], modes=["deterministic"]
            ),
            links_added=[],
            suggested=[],
            capture_archived=False,
            review_required=True,
            flagged=False,
        )
        runner = MagicMock()
        runner.run_pipeline = AsyncMock(side_effect=[filed, review])

        with (
            patch("agents.loom.weaver.get_weaver", return_value=MagicMock()),
            patch("agents.runner.AgentRunner", return_value=runner),
        ):
            resp = client.post("/api/captures/process-all")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["processed"] == 1
        assert data["filed"] == 1
        assert data["needs_review"] == 1
        assert data["skipped"] == 0
        assert data["failed"] == 0
        assert [result["outcome"] for result in data["results"]] == [
            "filed",
            "needs_review",
        ]
        assert data["results"][1]["processed"] is False

    @pytest.mark.asyncio
    async def test_cancellation_during_batch_reservation_cleans_running_rows(
        self,
        seeded_captures: Path,
        vault_manager,
        note_index,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A cancelled request cannot strand an earlier batch reservation."""
        original_reserve = captures_router._reserve_capture_job
        second_started = asyncio.Event()
        calls = 0

        async def reserve_with_barrier(vm, capture_path):
            nonlocal calls
            calls += 1
            if calls == 2:
                second_started.set()
                await asyncio.Event().wait()
            return await original_reserve(vm, capture_path)

        monkeypatch.setattr(
            captures_router,
            "_reserve_capture_job",
            reserve_with_barrier,
        )
        handler = inspect.unwrap(captures_router.process_all_captures)

        with patch("agents.loom.weaver.get_weaver", return_value=MagicMock()):
            task = asyncio.create_task(
                handler(request=MagicMock(), vm=vault_manager, index=note_index)
            )
            await asyncio.wait_for(second_started.wait(), timeout=1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        jobs = capture_job_store(seeded_captures).list_jobs()
        assert len(jobs) == 1
        assert jobs[0].status == "failed"
        assert "cancelled during reservation" in jobs[0].error


# ---------------------------------------------------------------------------
# POST /api/captures/preview  (dry-run)
# ---------------------------------------------------------------------------


class TestPreviewCapture:
    def test_preview_returns_proposal_and_candidates(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """Preview returns Weaver's proposal plus Spider candidates; skipped links drop out."""
        proposal = CaptureProposal(
            note_type="topic",
            folder="topics",
            title="Cool Idea",
            tags=["idea"],
            body="## Summary\n\nNeat.\n",
            raw_capture_id="thr_cap001",
        )
        mock_weaver = MagicMock()
        mock_weaver.propose_capture = AsyncMock(return_value=proposal)
        mock_spider = MagicMock()
        mock_spider.propose_candidates = AsyncMock(
            return_value=[
                LinkCandidate(note_id="thr_a", title="Alpha", score=0.91, decision="auto-linked"),
                LinkCandidate(note_id="thr_b", title="Beta", score=0.6, decision="suggested"),
                LinkCandidate(note_id="thr_c", title="Gamma", score=0.2, decision="skipped"),
            ]
        )

        with (
            patch("agents.loom.weaver.get_weaver", return_value=mock_weaver),
            patch("agents.loom.spider.get_spider", return_value=mock_spider),
        ):
            resp = client.post(
                "/api/captures/preview",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        preview = resp.json()["preview"]
        assert preview["note_type"] == "topic"
        assert preview["folder"] == "topics"
        assert preview["title"] == "Cool Idea"
        assert preview["body"].startswith("## Summary")
        # "skipped" candidate is filtered out; only auto-linked + suggested remain.
        decisions = {link["title"]: link["decision"] for link in preview["links"]}
        assert decisions == {"Alpha": "auto-linked", "Beta": "suggested"}

    def test_preview_no_writes(self, client: TestClient, seeded_captures: Path) -> None:
        """Preview must not archive the capture or add notes — the inbox is unchanged."""
        proposal = CaptureProposal(
            note_type="topic", folder="topics", title="X", tags=[], body="## Summary\n\nx\n"
        )
        mock_weaver = MagicMock()
        mock_weaver.propose_capture = AsyncMock(return_value=proposal)

        before = {item["id"] for item in client.get("/api/captures").json()}
        with (
            patch("agents.loom.weaver.get_weaver", return_value=mock_weaver),
            patch("agents.loom.spider.get_spider", return_value=None),
        ):
            resp = client.post(
                "/api/captures/preview",
                json={"capture_path": "captures/raw-idea.md"},
            )
        assert resp.status_code == 200

        after = {item["id"] for item in client.get("/api/captures").json()}
        assert before == after
        # Capture file still in the inbox, nothing archived.
        assert (seeded_captures / "threads" / "captures" / "raw-idea.md").exists()

    def test_preview_empty_capture_returns_null(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """An empty capture yields ``preview: null`` (not a 500)."""
        mock_weaver = MagicMock()
        mock_weaver.propose_capture = AsyncMock(return_value=None)

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/preview",
                json={"capture_path": "captures/raw-idea.md"},
            )

        assert resp.status_code == 200
        assert resp.json()["preview"] is None


# ---------------------------------------------------------------------------
# POST /api/captures/commit
# ---------------------------------------------------------------------------


class TestCommitCapture:
    def test_commit_writes_and_archives(self, client: TestClient, seeded_captures: Path) -> None:
        """Commit returns the created note and archives the capture out of the inbox."""
        note = Note(
            id="thr_new",
            title="Filed Note",
            type="topic",
            file_path="/tmp/threads/topics/filed.md",
            body="## Summary\n\nx\n",
        )
        mock_weaver = MagicMock()
        mock_weaver.commit_proposal = AsyncMock(return_value=(note, SimpleNamespace(success=True)))
        mock_sentinel = MagicMock()
        mock_sentinel.validate_action = AsyncMock(
            return_value=ValidationResult(status="passed", modes=["deterministic"])
        )

        with (
            patch("agents.loom.weaver.get_weaver", return_value=mock_weaver),
            patch("agents.loom.sentinel.get_sentinel", return_value=mock_sentinel),
            patch("agents.loom.spider.get_spider", return_value=None),
            patch("agents.loom.scribe.get_scribe", return_value=None),
        ):
            resp = client.post(
                "/api/captures/commit",
                json={
                    "capture_path": "captures/raw-idea.md",
                    "note_type": "topic",
                    "folder": "topics",
                    "title": "Filed Note",
                    "tags": ["idea"],
                    "body": "## Summary\n\nx\n",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["note"]["id"] == "thr_new"
        assert data["note"]["title"] == "Filed Note"
        assert data["capture_archived"] is True
        # Capture is moved out of the inbox.
        assert not (seeded_captures / "threads" / "captures" / "raw-idea.md").exists()

    def test_commit_missing_sentinel_keeps_capture_for_review(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """A committed proposal is not published when Sentinel is unavailable."""
        note = Note(
            id="thr_review",
            title="Needs Review",
            type="topic",
            file_path="/tmp/threads/topics/needs-review.md",
            body="## Summary\n\nx\n",
        )
        mock_weaver = MagicMock()
        mock_weaver.commit_proposal = AsyncMock(return_value=(note, SimpleNamespace(success=True)))
        mock_spider = MagicMock()
        mock_spider.scan_and_report = AsyncMock()

        with (
            patch("agents.loom.weaver.get_weaver", return_value=mock_weaver),
            patch("agents.loom.sentinel.get_sentinel", return_value=None),
            patch("agents.loom.spider.get_spider", return_value=mock_spider),
        ):
            resp = client.post(
                "/api/captures/commit",
                json={
                    "capture_path": "captures/raw-idea.md",
                    "note_type": "topic",
                    "folder": "topics",
                    "title": "Needs Review",
                    "tags": ["idea"],
                    "body": "## Summary\n\nx\n",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["validation"] == "unavailable"
        assert data["capture_archived"] is False
        assert data["review_required"] is True
        assert (seeded_captures / "threads" / "captures" / "raw-idea.md").exists()
        mock_spider.scan_and_report.assert_not_awaited()

    def test_commit_404_when_capture_missing(
        self, client: TestClient, seeded_captures: Path
    ) -> None:
        """Commit on a capture that no longer exists returns 404 (e.g. already processed)."""
        mock_weaver = MagicMock()

        with patch("agents.loom.weaver.get_weaver", return_value=mock_weaver):
            resp = client.post(
                "/api/captures/commit",
                json={
                    "capture_path": "captures/nonexistent.md",
                    "note_type": "topic",
                    "folder": "topics",
                    "title": "X",
                    "tags": [],
                    "body": "y",
                },
            )

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"]

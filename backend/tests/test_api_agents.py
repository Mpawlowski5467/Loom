"""Integration tests for agent action routes."""

from unittest.mock import AsyncMock, MagicMock, call, patch

from starlette.testclient import TestClient

from agents.loom.spider_models import ScanReport
from agents.shuttle.researcher import ResearchResult
from tests.conftest import _seed_notes


def test_spider_single_note_uses_index_file_path(
    client: TestClient,
    vault_manager,
    note_index,
) -> None:
    _seed_notes(
        vault_manager,
        note_index,
        [
            (
                "topics",
                "indexed.md",
                {
                    "id": "thr_indexed",
                    "title": "Indexed",
                    "type": "topic",
                    "tags": [],
                    "history": [],
                },
                "Body",
            )
        ],
    )
    spider = MagicMock()
    spider.scan_and_report = AsyncMock(
        return_value=ScanReport(source_id="thr_indexed", source_title="Indexed")
    )

    with patch("agents.loom.spider.get_spider", return_value=spider):
        resp = client.post("/api/agents/spider/scan?note_id=thr_indexed")

    assert resp.status_code == 200
    assert resp.json()["notes_scanned"] == 1
    spider.scan_and_report.assert_awaited_once()


def test_spider_scan_error_returns_error_response_not_200(
    client: TestClient,
    vault_manager,
    note_index,
) -> None:
    """When Spider's scan raises, the route returns an error status, not 200."""
    from core.exceptions import ProviderError

    _seed_notes(
        vault_manager,
        note_index,
        [
            (
                "topics",
                "indexed.md",
                {
                    "id": "thr_indexed",
                    "title": "Indexed",
                    "type": "topic",
                    "tags": [],
                    "history": [],
                },
                "Body",
            )
        ],
    )
    spider = MagicMock()
    spider.scan_and_report = AsyncMock(side_effect=ProviderError("fake", "embedding backend down"))

    with patch("agents.loom.spider.get_spider", return_value=spider):
        resp = client.post("/api/agents/spider/scan?note_id=thr_indexed")

    # ProviderError maps to 502 via the global handler — a proper error, not 200.
    assert resp.status_code == 502
    body = resp.json()
    assert "embedding backend down" in body["error"]
    assert body["type"] == "ProviderError"


def test_spider_scan_not_initialized_returns_503(
    client: TestClient,
    vault_manager,
    note_index,
) -> None:
    """With no Spider agent initialized, the route returns 503."""
    _seed_notes(vault_manager, note_index, [])

    with patch("agents.loom.spider.get_spider", return_value=None):
        resp = client.post("/api/agents/spider/scan?note_id=thr_x")

    assert resp.status_code == 503


def test_researcher_query_returns_structured_evidence_and_respects_preview(
    client: TestClient,
    vault_manager,
    note_index,
) -> None:
    _seed_notes(vault_manager, note_index, [])
    researcher = MagicMock()
    researcher.query = AsyncMock(
        return_value=ResearchResult(
            answer="Use [[Caching Strategies]].",
            referenced_notes=[
                {
                    "note_id": "thr_cache0",
                    "title": "Caching Strategies",
                    "path": "topics/caching-strategies.md",
                    "heading": "Summary",
                    "snippet": "Overview of caching techniques.",
                    "score": 0.91,
                    "type": "topic",
                    "note_type": "topic",
                }
            ],
            saved_to_inbox=False,
        )
    )

    with patch("agents.shuttle.researcher.get_researcher", return_value=researcher):
        response = client.post(
            "/api/agents/researcher/query",
            json={"question": "What is caching?", "save_capture": False},
        )

    assert response.status_code == 200
    assert response.json() == {
        "answer": "Use [[Caching Strategies]].",
        "referenced_notes": [
            {
                "note_id": "thr_cache0",
                "title": "Caching Strategies",
                "path": "topics/caching-strategies.md",
                "heading": "Summary",
                "snippet": "Overview of caching techniques.",
                "score": 0.91,
                "type": "topic",
                "note_type": "topic",
            }
        ],
        "capture_id": "",
        "capture_path": "",
        "saved_to_inbox": False,
    }
    researcher.query.assert_awaited_once_with("What is caching?", save_capture=False)


def test_researcher_query_defaults_to_legacy_save_behavior(
    client: TestClient,
    vault_manager,
    note_index,
) -> None:
    _seed_notes(vault_manager, note_index, [])
    researcher = MagicMock()
    researcher.query = AsyncMock(
        return_value=ResearchResult(
            answer="Saved answer",
            capture_id="thr_saved",
            capture_path="/vault/threads/captures/research-thr_saved.md",
            saved_to_inbox=True,
        )
    )

    with patch("agents.shuttle.researcher.get_researcher", return_value=researcher):
        response = client.post("/api/agents/researcher/query", json={"question": "Keep this"})

    assert response.status_code == 200
    assert response.json()["saved_to_inbox"] is True
    researcher.query.assert_awaited_once_with("Keep this", save_capture=True)


def test_researcher_query_can_persist_a_successful_workspace_turn(
    client: TestClient,
    vault_manager,
    note_index,
) -> None:
    _seed_notes(vault_manager, note_index, [])
    researcher = MagicMock()
    researcher.query = AsyncMock(return_value=ResearchResult(answer="Grounded [[Answer]]."))
    chat = MagicMock()

    with (
        patch("agents.shuttle.researcher.get_researcher", return_value=researcher),
        patch("agents.chat.get_chat_history", return_value=chat),
    ):
        response = client.post(
            "/api/agents/researcher/query",
            json={
                "question": "What did we decide?",
                "save_capture": False,
                "persist_chat": True,
            },
        )

    assert response.status_code == 200
    assert chat.save_message.call_args_list == [
        call("researcher", "user", "What did we decide?"),
        call("researcher", "assistant", "Grounded [[Answer]]."),
    ]


def test_standup_rejects_an_invalid_date(client: TestClient) -> None:
    with patch("agents.shuttle.standup.get_standup", return_value=MagicMock()):
        response = client.post(
            "/api/agents/standup/generate",
            json={"date": "tomorrow-ish"},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == "date must use YYYY-MM-DD format"

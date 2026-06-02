"""Integration tests for agent action routes."""

from unittest.mock import AsyncMock, MagicMock, patch

from starlette.testclient import TestClient

from agents.loom.spider_models import ScanReport
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

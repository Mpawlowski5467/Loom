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

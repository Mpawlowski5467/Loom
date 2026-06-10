"""Tests for the index API routes in api/routers/index.py."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

from starlette.testclient import TestClient

from api.routers import index as index_router

# ---------------------------------------------------------------------------
# GET /api/index/status
# ---------------------------------------------------------------------------


class TestIndexStatus:
    def test_indexer_not_initialized(self, client: TestClient) -> None:
        """GET /api/index/status when indexer is None returns ready=false."""
        with patch("api.routers.index.get_indexer", return_value=None):
            resp = client.get("/api/index/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is False
        assert "not initialized" in data["message"]

    def test_indexer_not_ready(self, client: TestClient) -> None:
        """GET /api/index/status when indexer exists but has no data returns ready=false."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=False)

        with patch("api.routers.index.get_indexer", return_value=mock_indexer):
            resp = client.get("/api/index/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is False
        assert "no data" in data["message"]

    def test_indexer_ready(self, client: TestClient) -> None:
        """GET /api/index/status when indexer is fully ready returns ready=true."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)

        with patch("api.routers.index.get_indexer", return_value=mock_indexer):
            resp = client.get("/api/index/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is True
        assert "ready" in data["message"].lower()


# ---------------------------------------------------------------------------
# GET /api/index/stats
# ---------------------------------------------------------------------------


class TestIndexStats:
    def test_stats_not_initialized(self, client: TestClient) -> None:
        """GET /api/index/stats with no indexer returns a clean empty payload."""
        with (
            patch("api.routers.index.get_indexer", return_value=None),
            patch("api.health._unindexed_count", return_value=3),
        ):
            resp = client.get("/api/index/stats")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is False
        assert data["total_chunks"] == 0
        assert data["distinct_notes"] == 0
        # The drift signal is reported even when the table is absent.
        assert data["unindexed_count"] == 3
        assert data["type_breakdown"] == {}

    def test_stats_not_ready(self, client: TestClient) -> None:
        """A table that exists but has no data still returns the empty payload."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=False)

        with (
            patch("api.routers.index.get_indexer", return_value=mock_indexer),
            patch("api.health._unindexed_count", return_value=0),
        ):
            resp = client.get("/api/index/stats")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is False
        assert data["total_chunks"] == 0

    def test_stats_populated(self, client: TestClient) -> None:
        """A ready index reports counts and a per-type chunk breakdown."""
        # Fake the Arrow scan: 6 chunks across 3 notes, two note types.
        note_ids = ["n1", "n1", "n1", "n2", "n2", "n3"]
        note_types = ["topic", "topic", "topic", "project", "project", "daily"]

        arrow = MagicMock()
        arrow.column.side_effect = lambda name: MagicMock(
            to_pylist=lambda: note_ids if name == "note_id" else note_types
        )
        table = MagicMock()
        table.count_rows.return_value = 6
        table.to_arrow.return_value.select.return_value = arrow

        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)
        mock_indexer.open_table.return_value = table

        with (
            patch("api.routers.index.get_indexer", return_value=mock_indexer),
            patch("api.health._unindexed_count", return_value=1),
        ):
            resp = client.get("/api/index/stats")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is True
        assert data["total_chunks"] == 6
        assert data["distinct_notes"] == 3
        assert data["unindexed_count"] == 1
        assert data["avg_chunks_per_note"] == 2.0
        assert data["type_breakdown"] == {"topic": 3, "project": 2, "daily": 1}

    def test_stats_table_read_error_degrades(self, client: TestClient) -> None:
        """If reading the table raises, stats degrade to the empty payload."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)
        mock_indexer.open_table.side_effect = RuntimeError("corrupt table")

        with (
            patch("api.routers.index.get_indexer", return_value=mock_indexer),
            patch("api.health._unindexed_count", return_value=0),
        ):
            resp = client.get("/api/index/stats")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is False
        assert data["total_chunks"] == 0


# ---------------------------------------------------------------------------
# POST /api/index/reindex
# ---------------------------------------------------------------------------


class TestReindex:
    def test_reindex_not_initialized(self, client: TestClient) -> None:
        """POST /api/index/reindex when indexer is None returns 503."""
        with patch("api.routers.index.get_indexer", return_value=None):
            resp = client.post("/api/index/reindex")

        assert resp.status_code == 503
        assert "not initialized" in resp.json()["detail"]

    def test_reindex_success(self, client: TestClient) -> None:
        """POST /api/index/reindex triggers reindex and returns chunk count."""
        mock_indexer = MagicMock()
        mock_indexer.reindex_vault = AsyncMock(return_value=42)

        with patch("api.routers.index.get_indexer", return_value=mock_indexer):
            resp = client.post("/api/index/reindex")

        assert resp.status_code == 200
        data = resp.json()
        assert data["chunks_indexed"] == 42


# ---------------------------------------------------------------------------
# POST /api/index/rebuild
# ---------------------------------------------------------------------------


class TestRebuild:
    def test_rebuild_not_initialized(self, client: TestClient) -> None:
        """POST /api/index/rebuild when indexer is None returns 503."""
        with patch("api.routers.index.get_indexer", return_value=None):
            resp = client.post("/api/index/rebuild")

        assert resp.status_code == 503

    def test_rebuild_success(self, client: TestClient) -> None:
        """POST /api/index/rebuild is an alias for reindex and returns chunk count."""
        mock_indexer = MagicMock()
        mock_indexer.reindex_vault = AsyncMock(return_value=10)

        with patch("api.routers.index.get_indexer", return_value=mock_indexer):
            resp = client.post("/api/index/rebuild")

        assert resp.status_code == 200
        data = resp.json()
        assert data["chunks_indexed"] == 10


# ---------------------------------------------------------------------------
# Reindex serialization
# ---------------------------------------------------------------------------


class TestReindexLock:
    def test_lock_exists(self) -> None:
        """The module exposes an asyncio.Lock guarding the drop/create cycle."""
        assert isinstance(index_router._reindex_lock, asyncio.Lock)

    def test_concurrent_reindex_serialized(self) -> None:
        """A second reindex waits for the first; their bodies never overlap."""

        async def run() -> int:
            active = 0
            max_active = 0

            async def fake_reindex(_threads_dir: object) -> int:
                nonlocal active, max_active
                active += 1
                max_active = max(max_active, active)
                await asyncio.sleep(0)  # yield so a racing call could interleave
                active -= 1
                return 1

            mock_indexer = MagicMock()
            mock_indexer.reindex_vault = AsyncMock(side_effect=fake_reindex)
            vm = MagicMock()
            vm.active_threads_dir.return_value = "threads"

            with patch("api.routers.index.get_indexer", return_value=mock_indexer):
                await asyncio.gather(
                    index_router._do_reindex(vm),
                    index_router._do_reindex(vm),
                )
            return max_active

        max_active = asyncio.run(run())
        # The lock means at most one reindex body runs at a time.
        assert max_active == 1

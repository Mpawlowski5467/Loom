"""Tests for the index API routes in api/routers/index.py."""

from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

from starlette.testclient import TestClient

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

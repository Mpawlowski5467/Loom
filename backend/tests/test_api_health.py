"""Tests for /api/health and /api/ready endpoints."""

from unittest.mock import MagicMock, PropertyMock, patch

from starlette.testclient import TestClient

# ---------------------------------------------------------------------------
# GET /api/health — structured shape
# ---------------------------------------------------------------------------


class TestHealthShape:
    def test_health_returns_structured_shape(self, client: TestClient) -> None:
        """GET /api/health returns the new {ok, components{...}} shape."""
        resp = client.get("/api/health")

        assert resp.status_code == 200
        data = resp.json()

        # Top-level shape
        assert "ok" in data
        assert isinstance(data["ok"], bool)
        assert "components" in data
        assert isinstance(data["components"], dict)

        # Required components
        components = data["components"]
        assert set(components.keys()) == {"indexer", "agents", "watcher", "chat"}

        # Per-component shape
        assert "ready" in components["indexer"]
        assert "details" in components["indexer"]
        assert isinstance(components["indexer"]["ready"], bool)
        assert isinstance(components["indexer"]["details"], str)

        assert "ready" in components["agents"]
        assert "count" in components["agents"]
        assert isinstance(components["agents"]["ready"], bool)
        assert isinstance(components["agents"]["count"], int)

        assert "ready" in components["watcher"]
        assert isinstance(components["watcher"]["ready"], bool)

        assert "ready" in components["chat"]
        assert isinstance(components["chat"]["ready"], bool)

    def test_health_ok_true_when_all_ready(self, client: TestClient) -> None:
        """ok is true iff all component.ready are true."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)
        mock_runner = MagicMock()
        mock_runner.list_agents.return_value = [{"name": "weaver"}, {"name": "spider"}]
        mock_observer = MagicMock()
        mock_observer.is_alive.return_value = True
        mock_chat = MagicMock()

        with (
            patch("index.indexer.get_indexer", return_value=mock_indexer),
            patch("agents.runner.get_runner", return_value=mock_runner),
            patch("core.watcher._observer", mock_observer),
            patch("agents.chat.get_chat_history", return_value=mock_chat),
        ):
            resp = client.get("/api/health")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["components"]["indexer"]["ready"] is True
        assert data["components"]["agents"]["ready"] is True
        assert data["components"]["agents"]["count"] == 2
        assert data["components"]["watcher"]["ready"] is True
        assert data["components"]["chat"]["ready"] is True

    def test_health_ok_false_when_any_component_down(self, client: TestClient) -> None:
        """ok is false when even one component is not ready."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)
        mock_runner = MagicMock()
        mock_runner.list_agents.return_value = [{"name": "weaver"}]
        mock_chat = MagicMock()

        with (
            patch("index.indexer.get_indexer", return_value=mock_indexer),
            patch("agents.runner.get_runner", return_value=mock_runner),
            patch("core.watcher._observer", None),  # watcher down
            patch("agents.chat.get_chat_history", return_value=mock_chat),
        ):
            resp = client.get("/api/health")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert data["components"]["watcher"]["ready"] is False

    def test_health_indexer_not_initialized(self, client: TestClient) -> None:
        """Indexer reports not ready with helpful details."""
        with patch("index.indexer.get_indexer", return_value=None):
            resp = client.get("/api/health")

        data = resp.json()
        assert data["components"]["indexer"]["ready"] is False
        assert "not initialized" in data["components"]["indexer"]["details"]


# ---------------------------------------------------------------------------
# GET /api/ready
# ---------------------------------------------------------------------------


class TestReadyEndpoint:
    def test_ready_returns_200_when_ok(self, client: TestClient) -> None:
        """/api/ready returns 200 when all components ready."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)
        mock_runner = MagicMock()
        mock_runner.list_agents.return_value = [{"name": "weaver"}]
        mock_observer = MagicMock()
        mock_observer.is_alive.return_value = True
        mock_chat = MagicMock()

        with (
            patch("index.indexer.get_indexer", return_value=mock_indexer),
            patch("agents.runner.get_runner", return_value=mock_runner),
            patch("core.watcher._observer", mock_observer),
            patch("agents.chat.get_chat_history", return_value=mock_chat),
        ):
            resp = client.get("/api/ready")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_ready_returns_503_when_not_ok(self, client: TestClient) -> None:
        """/api/ready returns 503 when any component is not ready."""
        with (
            patch("index.indexer.get_indexer", return_value=None),
            patch("agents.runner.get_runner", return_value=None),
            patch("core.watcher._observer", None),
            patch("agents.chat.get_chat_history", return_value=None),
        ):
            resp = client.get("/api/ready")

        assert resp.status_code == 503
        data = resp.json()
        assert data["ok"] is False
        assert data["components"]["indexer"]["ready"] is False
        assert data["components"]["agents"]["ready"] is False
        assert data["components"]["watcher"]["ready"] is False
        assert data["components"]["chat"]["ready"] is False

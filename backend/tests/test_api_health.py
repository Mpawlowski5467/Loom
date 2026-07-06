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
        assert set(components.keys()) == {
            "indexer",
            "agents",
            "watcher",
            "chat",
            "cache",
            "database",
        }

        # Per-component shape
        assert "ready" in components["indexer"]
        assert "details" in components["indexer"]
        assert isinstance(components["indexer"]["ready"], bool)
        assert isinstance(components["indexer"]["details"], str)
        # Index-drift signal: a separate integer, NOT folded into `ready`.
        assert "unindexed" in components["indexer"]
        assert isinstance(components["indexer"]["unindexed"], int)

        assert "ready" in components["agents"]
        assert "count" in components["agents"]
        assert isinstance(components["agents"]["ready"], bool)
        assert isinstance(components["agents"]["count"], int)

        assert "ready" in components["watcher"]
        assert isinstance(components["watcher"]["ready"], bool)

        assert "ready" in components["chat"]
        assert isinstance(components["chat"]["ready"], bool)

        # Optional services report {ready, configured, connected}.
        for optional in ("cache", "database"):
            assert isinstance(components[optional]["ready"], bool)
            assert isinstance(components[optional]["configured"], bool)
            assert isinstance(components[optional]["connected"], bool)

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
        assert data["components"]["indexer"]["unindexed"] == 0

    def test_health_unindexed_reflects_drift_without_affecting_ready(
        self, client: TestClient
    ) -> None:
        """unindexed surfaces drift while ready stays True (has data)."""
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)

        with (
            patch("index.indexer.get_indexer", return_value=mock_indexer),
            patch("index.indexer.unindexed_note_ids", return_value=["thr_a", "thr_b", "thr_c"]),
            patch("core.watcher.failed_index_paths", return_value=1),
        ):
            resp = client.get("/api/health")

        data = resp.json()
        indexer = data["components"]["indexer"]
        # ready is unchanged (index has data); drift is reported separately.
        assert indexer["ready"] is True
        assert indexer["unindexed"] == 3  # max(len(drift)=3, failed=1)


# ---------------------------------------------------------------------------
# Optional services (cache / database) — must never gate readiness
# ---------------------------------------------------------------------------


class TestOptionalServiceComponents:
    def test_unconfigured_services_ready_but_not_configured(self, client: TestClient) -> None:
        """With no Redis/Postgres configured: ready True, configured/connected False."""
        resp = client.get("/api/health")

        data = resp.json()
        for name in ("cache", "database"):
            component = data["components"][name]
            assert component["ready"] is True
            assert component["configured"] is False
            assert component["connected"] is False

    def test_configured_but_down_cache_stays_ready(self, client: TestClient, monkeypatch) -> None:
        """A configured but unreachable Redis reports connected False, ready True."""
        from core.cache import reset_response_cache
        from core.config import settings

        monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:1/0")
        reset_response_cache()

        resp = client.get("/api/health")

        cache = resp.json()["components"]["cache"]
        assert cache["ready"] is True
        assert cache["configured"] is True
        assert cache["connected"] is False

    def test_configured_but_down_database_stays_ready(
        self, client: TestClient, monkeypatch
    ) -> None:
        """A configured Postgres URL with no live mirror reports connected False."""
        from core.config import settings

        monkeypatch.setattr(settings, "database_url", "postgresql://loom@127.0.0.1:1/loom")

        resp = client.get("/api/health")

        database = resp.json()["components"]["database"]
        assert database["ready"] is True
        assert database["configured"] is True
        assert database["connected"] is False

    def test_ready_endpoint_unaffected_by_optional_services(
        self, client: TestClient, monkeypatch
    ) -> None:
        """/api/ready must not 503 because optional services are down."""
        from core.cache import reset_response_cache
        from core.config import settings

        monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:1/0")
        monkeypatch.setattr(settings, "database_url", "postgresql://loom@127.0.0.1:1/loom")
        reset_response_cache()
        mock_indexer = MagicMock()
        type(mock_indexer).is_ready = PropertyMock(return_value=True)
        mock_runner = MagicMock()
        mock_runner.list_agents.return_value = [{"name": "weaver"}]
        mock_observer = MagicMock()
        mock_observer.is_alive.return_value = True

        with (
            patch("index.indexer.get_indexer", return_value=mock_indexer),
            patch("agents.runner.get_runner", return_value=mock_runner),
            patch("core.watcher._observer", mock_observer),
            patch("agents.chat.get_chat_history", return_value=MagicMock()),
        ):
            resp = client.get("/api/ready")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True


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

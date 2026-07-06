"""Tests for GET /api/providers/{name}/models."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from unittest.mock import patch

import httpx
import pytest

from core.config import GlobalConfig, ProviderConfig

if TYPE_CHECKING:
    from pathlib import Path

    from starlette.testclient import TestClient


def _setup_config(tmp_path: Path, providers: dict[str, ProviderConfig] | None = None) -> Path:
    cfg_path = tmp_path / ".loom" / "config.yaml"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg = GlobalConfig(active_vault="default")
    if providers:
        cfg.providers = providers
    cfg.save(cfg_path)
    return cfg_path


_OLLAMA_TAGS = [
    {
        "name": "llama3.1:8b",
        "size": 4_700_000_000,
        "details": {"parameter_size": "8.0B"},
    },
    {
        "name": "nomic-embed-text:latest",
        "size": 274_000_000,
        "details": {"parameter_size": "137M"},
    },
    {"name": "bge-m3", "size": 1_200_000_000, "details": {}},
]


class TestUnknownProvider:
    def test_unknown_name_404(self, client: TestClient, tmp_path: Path) -> None:
        cfg_path = _setup_config(tmp_path)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/providers/nope/models")
        assert resp.status_code == 404


class TestOllamaModels:
    def test_tags_split_into_chat_and_embed(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(
            tmp_path, {"ollama": ProviderConfig(host="http://localhost:11434")}
        )

        seen_hosts: list[str] = []

        async def fake_tags(host: str) -> list[dict[str, Any]]:
            seen_hosts.append(host)
            return _OLLAMA_TAGS

        monkeypatch.setattr("api.routers.providers.fetch_ollama_tags", fake_tags)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/providers/ollama/models")

        assert resp.status_code == 200
        data = resp.json()
        chat_ids = [m["id"] for m in data["chat"]]
        embed_ids = [m["id"] for m in data["embed"]]
        assert chat_ids == ["llama3.1:8b"]
        # embed / bge markers classify as embed models
        assert set(embed_ids) == {"nomic-embed-text:latest", "bge-m3"}
        for m in data["chat"]:
            assert m == {"id": m["id"], "name": m["id"], "type": "chat"}
        for m in data["embed"]:
            assert m["type"] == "embed"
        assert seen_hosts == ["http://localhost:11434"]

    def test_configured_host_is_used(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path, {"ollama": ProviderConfig(host="http://gpu-box:11434")})
        seen_hosts: list[str] = []

        async def fake_tags(host: str) -> list[dict[str, Any]]:
            seen_hosts.append(host)
            return []

        monkeypatch.setattr("api.routers.providers.fetch_ollama_tags", fake_tags)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            client.get("/api/providers/ollama/models")

        assert seen_hosts == ["http://gpu-box:11434"]

    def test_unreachable_host_returns_empty_lists(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)

        async def fake_tags(host: str) -> list[dict[str, Any]]:  # noqa: ARG001
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr("api.routers.providers.fetch_ollama_tags", fake_tags)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/providers/ollama/models")

        assert resp.status_code == 200
        assert resp.json() == {"chat": [], "embed": []}


class TestAnthropicStatic:
    def test_static_list_no_key_needed(self, client: TestClient, tmp_path: Path) -> None:
        cfg_path = _setup_config(tmp_path)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/providers/anthropic/models")

        assert resp.status_code == 200
        data = resp.json()
        chat_ids = [m["id"] for m in data["chat"]]
        assert "claude-sonnet-4-20250514" in chat_ids
        assert data["embed"] == []
        assert all(m["type"] == "chat" for m in data["chat"])


class _FakeModel:
    def __init__(self, model_id: str) -> None:
        self.id = model_id


class _FakePage:
    def __init__(self, ids: list[str]) -> None:
        self.data = [_FakeModel(i) for i in ids]


class _FakeModels:
    def __init__(self, ids: list[str], error: Exception | None = None) -> None:
        self._ids = ids
        self._error = error

    async def list(self) -> _FakePage:
        if self._error is not None:
            raise self._error
        return _FakePage(self._ids)


class _FakeClient:
    def __init__(self, ids: list[str], error: Exception | None = None) -> None:
        self.models = _FakeModels(ids, error)


class _FakeProvider:
    def __init__(self, ids: list[str], error: Exception | None = None) -> None:
        self._client = _FakeClient(ids, error)
        self.closed = False

    async def close(self) -> None:
        self.closed = True


class TestOpenAICompatibleModels:
    def test_live_listing_classifies_and_closes(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path, {"openai": ProviderConfig(api_key="sk-test")})
        fake = _FakeProvider(["gpt-4o", "gpt-4o-mini", "text-embedding-3-small"])
        monkeypatch.setattr("api.routers.providers.build_provider_from_input", lambda _p: fake)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/providers/openai/models")

        assert resp.status_code == 200
        data = resp.json()
        assert [m["id"] for m in data["chat"]] == ["gpt-4o", "gpt-4o-mini"]
        assert [m["id"] for m in data["embed"]] == ["text-embedding-3-small"]
        assert fake.closed is True

    def test_listing_failure_falls_back_to_static(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path, {"openai": ProviderConfig(api_key="sk-test")})
        fake = _FakeProvider([], error=RuntimeError("api down"))
        monkeypatch.setattr("api.routers.providers.build_provider_from_input", lambda _p: fake)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/providers/openai/models")

        assert resp.status_code == 200
        chat_ids = [m["id"] for m in resp.json()["chat"]]
        assert "gpt-4o" in chat_ids  # static fallback
        assert fake.closed is True

    def test_no_key_configured_falls_back_to_static(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _setup_config(tmp_path)  # openai not configured at all
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with patch("api.routers.providers.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/providers/openai/models")

        assert resp.status_code == 200
        data = resp.json()
        assert "gpt-4o" in [m["id"] for m in data["chat"]]
        assert "text-embedding-3-small" in [m["id"] for m in data["embed"]]


class TestFetchOllamaTags:
    @pytest.mark.asyncio
    async def test_parses_tags_payload(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """fetch_ollama_tags drives httpx.AsyncClient against /api/tags."""
        from api.routers import providers as providers_mod

        requested: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(str(request.url))
            return httpx.Response(200, json={"models": _OLLAMA_TAGS})

        real_async_client = httpx.AsyncClient

        def fake_async_client(**kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(handler)
            return real_async_client(**kwargs)

        monkeypatch.setattr(providers_mod.httpx, "AsyncClient", fake_async_client)

        tags = await providers_mod.fetch_ollama_tags("http://localhost:11434/")
        assert [t["name"] for t in tags] == [
            "llama3.1:8b",
            "nomic-embed-text:latest",
            "bge-m3",
        ]
        assert requested == ["http://localhost:11434/api/tags"]

    @pytest.mark.asyncio
    async def test_http_error_propagates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from api.routers import providers as providers_mod

        def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
            return httpx.Response(500)

        real_async_client = httpx.AsyncClient

        def fake_async_client(**kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(handler)
            return real_async_client(**kwargs)

        monkeypatch.setattr(providers_mod.httpx, "AsyncClient", fake_async_client)

        with pytest.raises(httpx.HTTPError):
            await providers_mod.fetch_ollama_tags("http://localhost:11434")

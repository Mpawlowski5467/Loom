"""Tests for the wizard-facing provider router (api/routers/providers.py).

Covers ``POST /api/providers/{name}/test`` — the pre-save credential check the
onboarding wizard relies on: unknown name → 404; success → ok=True; provider
error → ok=False with the message; timeout → ok=False, "Timed out after 10s".
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from starlette.testclient import TestClient


def _config_with(name: str, *, embed_model: str = "") -> MagicMock:
    """A GlobalConfig stub exposing one configured provider."""
    provider = MagicMock()
    provider.api_key = "sk-test"
    provider.host = ""
    provider.chat_model = "gpt-4o"
    provider.embed_model = embed_model
    cfg = MagicMock()
    cfg.providers = {name: provider}
    cfg.default_provider = name
    return cfg


class TestProviderTestEndpoint:
    def test_unknown_provider_returns_404(self, client: TestClient) -> None:
        resp = client.post("/api/providers/nope/test")
        assert resp.status_code == 404
        assert "Unknown provider" in resp.json()["detail"]

    def test_success_returns_ok_true(self, client: TestClient) -> None:
        """A provider that answers the ping pings ok=True."""
        stub_provider = AsyncMock()
        stub_provider.chat = AsyncMock(return_value="pong")

        with (
            patch(
                "api.routers.providers.GlobalConfig.load",
                return_value=_config_with("openai"),
            ),
            patch(
                "api.routers.providers.build_provider_from_input",
                return_value=stub_provider,
            ),
        ):
            resp = client.post("/api/providers/openai/test")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["error"] is None
        stub_provider.chat.assert_awaited_once()

    def test_success_uses_embed_when_embed_model_set(self, client: TestClient) -> None:
        """A provider configured with an embed model is tested via embed()."""
        stub_provider = AsyncMock()
        stub_provider.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])

        with (
            patch(
                "api.routers.providers.GlobalConfig.load",
                return_value=_config_with("openai", embed_model="text-embedding-3-small"),
            ),
            patch(
                "api.routers.providers.build_provider_from_input",
                return_value=stub_provider,
            ),
        ):
            resp = client.post("/api/providers/openai/test")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        stub_provider.embed.assert_awaited_once()

    def test_provider_error_returns_ok_false_with_message(self, client: TestClient) -> None:
        """A provider that raises surfaces ok=False and the error inline (HTTP 200)."""
        stub_provider = AsyncMock()
        stub_provider.chat = AsyncMock(side_effect=RuntimeError("bad key"))

        with (
            patch(
                "api.routers.providers.GlobalConfig.load",
                return_value=_config_with("openai"),
            ),
            patch(
                "api.routers.providers.build_provider_from_input",
                return_value=stub_provider,
            ),
        ):
            resp = client.post("/api/providers/openai/test")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert "bad key" in data["error"]

    def test_timeout_returns_ok_false_with_timeout_message(self, client: TestClient) -> None:
        """A slow provider trips the 10s timeout and reports it inline."""
        stub_provider = AsyncMock()
        stub_provider.chat = AsyncMock(side_effect=TimeoutError())

        with (
            patch(
                "api.routers.providers.GlobalConfig.load",
                return_value=_config_with("openai"),
            ),
            patch(
                "api.routers.providers.build_provider_from_input",
                return_value=stub_provider,
            ),
        ):
            resp = client.post("/api/providers/openai/test")

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert data["error"] == "Timed out after 10s"

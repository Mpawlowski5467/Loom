"""Tests for api/routers/settings.py — POST /api/settings/providers."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import yaml

from core.config import GlobalConfig, ProviderConfig

if TYPE_CHECKING:
    from pathlib import Path

    from starlette.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _setup_config(tmp_path: Path) -> Path:
    """Write a minimal config.yaml and return its path."""
    cfg_path = tmp_path / ".loom" / "config.yaml"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    GlobalConfig(active_vault="default").save(cfg_path)
    return cfg_path


# ---------------------------------------------------------------------------
# POST /api/settings/providers
# ---------------------------------------------------------------------------


class TestSaveProviders:
    """Integration tests for the provider-save endpoint."""

    def test_save_single_cloud_provider(self, client: TestClient, tmp_path: Path) -> None:
        """Saving a single cloud provider persists to config.yaml."""
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock),
        ):
            mock_settings.config_path = cfg_path

            resp = client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "sk-test-key",
                            "chat_model": "gpt-4o",
                            "embed_model": "text-embedding-3-small",
                            "is_default": True,
                        }
                    ]
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["saved"] == 1
        assert data["default_chat_provider"] == "openai"
        assert data["default_embed_provider"] == "openai"

        # Verify persisted YAML
        saved = yaml.safe_load(cfg_path.read_text())
        assert "openai" in saved["providers"]
        assert saved["providers"]["openai"]["api_key"] == "sk-test-key"

    def test_save_multiple_providers(self, client: TestClient, tmp_path: Path) -> None:
        """Saving multiple providers stores all of them."""
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock),
        ):
            mock_settings.config_path = cfg_path

            resp = client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "sk-test",
                            "chat_model": "gpt-4o",
                            "embed_model": "text-embedding-3-small",
                            "is_default": True,
                        },
                        {
                            "name": "ollama",
                            "type": "local",
                            "host": "http://localhost:11434",
                            "chat_model": "llama3",
                            "embed_model": "nomic-embed-text",
                            "is_default": False,
                        },
                    ]
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["saved"] == 2

        saved = yaml.safe_load(cfg_path.read_text())
        assert "openai" in saved["providers"]
        assert "ollama" in saved["providers"]

    def test_save_empty_providers_rejected(self, client: TestClient, tmp_path: Path) -> None:
        """Sending an empty providers list is rejected (would wipe credentials)."""
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock),
        ):
            mock_settings.config_path = cfg_path

            resp = client.post(
                "/api/settings/providers",
                json={"providers": []},
            )

        assert resp.status_code == 422

    def test_overwrite_existing_providers(self, client: TestClient, tmp_path: Path) -> None:
        """Saving overwrites previously configured providers."""
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock),
        ):
            mock_settings.config_path = cfg_path

            # First save
            client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "sk-old",
                            "chat_model": "gpt-4o",
                            "is_default": True,
                        }
                    ]
                },
            )

            # Second save with different key
            resp = client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "sk-new",
                            "chat_model": "gpt-4o-mini",
                            "is_default": True,
                        }
                    ]
                },
            )

        assert resp.status_code == 200
        saved = yaml.safe_load(cfg_path.read_text())
        assert saved["providers"]["openai"]["api_key"] == "sk-new"
        assert saved["providers"]["openai"]["chat_model"] == "gpt-4o-mini"

    def test_default_provider_selection(self, client: TestClient, tmp_path: Path) -> None:
        """Only the provider marked is_default becomes default."""
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock),
        ):
            mock_settings.config_path = cfg_path

            resp = client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "sk-test",
                            "chat_model": "gpt-4o",
                            "embed_model": "",
                            "is_default": False,
                        },
                        {
                            "name": "anthropic",
                            "type": "cloud",
                            "api_key": "sk-ant-test",
                            "chat_model": "claude-sonnet-4-20250514",
                            "embed_model": "",
                            "is_default": True,
                        },
                    ]
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["default_chat_provider"] == "anthropic"
        # anthropic has no embed_model set, so embed_provider should be None
        assert data["default_embed_provider"] is None

    def test_local_provider_with_host(self, client: TestClient, tmp_path: Path) -> None:
        """Ollama-style local provider stores host field."""
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock),
        ):
            mock_settings.config_path = cfg_path

            resp = client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "ollama",
                            "type": "local",
                            "host": "http://gpu-box:11434",
                            "chat_model": "llama3",
                            "embed_model": "nomic-embed-text",
                            "is_default": True,
                        }
                    ]
                },
            )

        assert resp.status_code == 200
        saved = yaml.safe_load(cfg_path.read_text())
        assert saved["providers"]["ollama"]["host"] == "http://gpu-box:11434"

    def test_reset_registry_called(self, client: TestClient, tmp_path: Path) -> None:
        """After a successful save, the provider registry is reset."""
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock) as mock_reset,
        ):
            mock_settings.config_path = cfg_path

            client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "sk-test",
                            "chat_model": "gpt-4o",
                            "is_default": True,
                        }
                    ]
                },
            )

        mock_reset.assert_called_once()

    def test_invalid_body_422(self, client: TestClient) -> None:
        """Missing required `providers` key returns 422."""
        resp = client.post("/api/settings/providers", json={})
        assert resp.status_code == 422

    def test_invalid_provider_entry_422(self, client: TestClient) -> None:
        """Provider entry missing `name` and `type` returns 422."""
        resp = client.post(
            "/api/settings/providers",
            json={"providers": [{"api_key": "sk-test"}]},
        )
        assert resp.status_code == 422


class TestGetProviders:
    """Integration tests for GET /api/settings/providers."""

    def test_get_returns_masked_keys(self, client: TestClient, tmp_path: Path) -> None:
        """The GET endpoint returns providers with masked api_keys."""
        cfg_path = _setup_config(tmp_path)
        cfg = GlobalConfig.load(cfg_path)
        cfg.providers = {
            "openai": ProviderConfig(
                api_key="sk-very-secret-1234",
                chat_model="gpt-4o",
                embed_model="text-embedding-3-small",
            ),
            "ollama": ProviderConfig(
                host="http://localhost:11434",
                chat_model="llama3",
                embed_model="nomic-embed-text",
            ),
        }
        cfg.chat_provider = "openai"
        cfg.embed_provider = "openai"
        cfg.save(cfg_path)

        with patch("api.routers.settings.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/settings/providers")

        assert resp.status_code == 200
        data = resp.json()
        assert data["active_vault"] == "default"
        names = {p["name"] for p in data["providers"]}
        assert names == {"openai", "ollama"}
        openai = next(p for p in data["providers"] if p["name"] == "openai")
        assert openai["api_key_set"] is True
        assert openai["api_key"].startswith("…")
        assert "sk-very-secret-1234" not in openai["api_key"]
        assert openai["is_default_chat"] is True
        ollama = next(p for p in data["providers"] if p["name"] == "ollama")
        assert ollama["api_key_set"] is False
        assert ollama["host"] == "http://localhost:11434"
        assert ollama["type"] == "local"

    def test_get_empty(self, client: TestClient, tmp_path: Path) -> None:
        """Returns an empty list when no providers are configured."""
        cfg_path = _setup_config(tmp_path)
        with patch("api.routers.settings.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/settings/providers")

        assert resp.status_code == 200
        assert resp.json()["providers"] == []


class TestSaveProvidersKeyPreservation:
    """Saving with empty api_key for an existing provider must keep the prior key."""

    def test_empty_api_key_preserves_prior(self, client: TestClient, tmp_path: Path) -> None:
        cfg_path = _setup_config(tmp_path)

        with (
            patch("api.routers.settings.settings") as mock_settings,
            patch("api.routers.settings.reset_registry", new_callable=AsyncMock),
        ):
            mock_settings.config_path = cfg_path

            # First save with a real key
            client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "sk-original",
                            "chat_model": "gpt-4o",
                            "is_default": True,
                        }
                    ]
                },
            )

            # Second save with empty api_key (UI sent the masked placeholder back)
            client.post(
                "/api/settings/providers",
                json={
                    "providers": [
                        {
                            "name": "openai",
                            "type": "cloud",
                            "api_key": "",
                            "chat_model": "gpt-4o",
                            "is_default": True,
                        }
                    ]
                },
            )

        saved = yaml.safe_load(cfg_path.read_text())
        assert saved["providers"]["openai"]["api_key"] == "sk-original"

"""Tests for per-agent model overrides: registry keying, resolution, and API."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING, Any
from unittest.mock import patch

import pytest
import yaml

from core.config import AgentModelOverride, GlobalConfig, ProviderConfig
from core.providers import OllamaProvider, ProviderRegistry, unwrap_provider

if TYPE_CHECKING:
    from pathlib import Path

    from starlette.testclient import TestClient


def _ollama_config(**extra: Any) -> GlobalConfig:
    return GlobalConfig(
        providers={"ollama": ProviderConfig(host="http://localhost:11434", chat_model="llama3")},
        chat_provider="ollama",
        **extra,
    )


def _save_config(tmp_path: Path, cfg: GlobalConfig) -> Path:
    cfg_path = tmp_path / ".loom" / "config.yaml"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.save(cfg_path)
    return cfg_path


def _patch_registry_settings(monkeypatch: pytest.MonkeyPatch, cfg_path: Path) -> None:
    monkeypatch.setattr(
        "core.providers.registry.settings",
        SimpleNamespace(config_path=cfg_path, default_provider="ollama"),
    )


# ---------------------------------------------------------------------------
# Registry: (name, chat_model) cache keying
# ---------------------------------------------------------------------------


class TestRegistryModelKeying:
    def test_distinct_models_get_distinct_instances(self) -> None:
        registry = ProviderRegistry(_ollama_config())

        default = registry.get("ollama")
        override = registry.get("ollama", "qwen2.5:7b")
        override_again = registry.get("ollama", "qwen2.5:7b")

        assert default is not override
        assert override is override_again
        assert unwrap_provider(default)._chat_model == "llama3"
        assert unwrap_provider(override)._chat_model == "qwen2.5:7b"

    def test_no_model_arg_matches_empty_override(self) -> None:
        """get(name) and get(name, None) share one cache slot."""
        registry = ProviderRegistry(_ollama_config())
        assert registry.get("ollama") is registry.get("ollama", None)

    @pytest.mark.asyncio
    async def test_close_closes_every_cached_instance(self) -> None:
        registry = ProviderRegistry(_ollama_config())
        default = registry.get("ollama")
        override = registry.get("ollama", "qwen2.5:7b")
        assert isinstance(unwrap_provider(default), OllamaProvider)

        closed: list[str] = []

        def track(label: str) -> Any:
            async def _close() -> None:
                closed.append(label)

            return _close

        default.close = track("default")
        override.close = track("override")
        await registry.close()

        assert sorted(closed) == ["default", "override"]


# ---------------------------------------------------------------------------
# Registry: get_chat_provider_for
# ---------------------------------------------------------------------------


class TestGetChatProviderFor:
    def test_override_binds_model(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        cfg = _ollama_config(agent_models={"weaver": AgentModelOverride(chat_model="qwen2.5:7b")})
        cfg_path = _save_config(tmp_path, cfg)
        _patch_registry_settings(monkeypatch, cfg_path)
        registry = ProviderRegistry(GlobalConfig.load(cfg_path))

        provider = registry.get_chat_provider_for("weaver")

        assert unwrap_provider(provider)._chat_model == "qwen2.5:7b"

    def test_no_override_falls_back_to_default(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg_path = _save_config(tmp_path, _ollama_config())
        _patch_registry_settings(monkeypatch, cfg_path)
        registry = ProviderRegistry(GlobalConfig.load(cfg_path))

        provider = registry.get_chat_provider_for("spider")

        assert provider is registry.get_chat_provider()
        assert unwrap_provider(provider)._chat_model == "llama3"

    def test_override_provider_switch(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg = GlobalConfig(
            providers={
                "openai": ProviderConfig(api_key="sk-test", chat_model="gpt-4o"),
                "ollama": ProviderConfig(host="http://localhost:11434", chat_model="llama3"),
            },
            chat_provider="openai",
            agent_models={"scribe": AgentModelOverride(provider="ollama")},
        )
        cfg_path = _save_config(tmp_path, cfg)
        _patch_registry_settings(monkeypatch, cfg_path)
        registry = ProviderRegistry(GlobalConfig.load(cfg_path))

        provider = registry.get_chat_provider_for("scribe")

        assert isinstance(unwrap_provider(provider), OllamaProvider)

    def test_unbuildable_override_falls_back(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg = _ollama_config(agent_models={"sentinel": AgentModelOverride(provider="anthropic")})
        cfg_path = _save_config(tmp_path, cfg)
        _patch_registry_settings(monkeypatch, cfg_path)
        registry = ProviderRegistry(GlobalConfig.load(cfg_path))

        provider = registry.get_chat_provider_for("sentinel")

        assert isinstance(unwrap_provider(provider), OllamaProvider)

    def test_record_fields_are_lower_priority_fallbacks(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cfg = _ollama_config(agent_models={"digest": AgentModelOverride(chat_model="from-config")})
        cfg_path = _save_config(tmp_path, cfg)
        _patch_registry_settings(monkeypatch, cfg_path)
        registry = ProviderRegistry(GlobalConfig.load(cfg_path))

        # agent_models wins over the record-supplied model...
        provider = registry.get_chat_provider_for(
            "digest", provider="ollama", chat_model="from-record"
        )
        assert unwrap_provider(provider)._chat_model == "from-config"

        # ...but record fields apply when no config override exists.
        provider = registry.get_chat_provider_for(
            "other", provider="ollama", chat_model="from-record"
        )
        assert unwrap_provider(provider)._chat_model == "from-record"

    def test_fresh_config_read_sees_new_overrides(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Overrides saved after registry creation are still honored."""
        cfg_path = _save_config(tmp_path, _ollama_config())
        _patch_registry_settings(monkeypatch, cfg_path)
        registry = ProviderRegistry(GlobalConfig.load(cfg_path))

        updated = _ollama_config(
            agent_models={"weaver": AgentModelOverride(chat_model="late-model")}
        )
        updated.save(cfg_path)

        provider = registry.get_chat_provider_for("weaver")
        assert unwrap_provider(provider)._chat_model == "late-model"


# ---------------------------------------------------------------------------
# Custom-agent provider resolution (agents/runner.py)
# ---------------------------------------------------------------------------


class _FakeRegistry:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None, str | None]] = []

    def get_chat_provider_for(
        self,
        agent_id: str,
        *,
        provider: str | None = None,
        chat_model: str | None = None,
    ) -> str:
        self.calls.append((agent_id, provider, chat_model))
        return "fake-provider"


class TestRunnerCustomAgentResolution:
    def test_record_fields_passed_through(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from agents import runner as runner_mod

        fake = _FakeRegistry()
        monkeypatch.setattr("core.providers.get_registry", lambda: fake)

        record = {"id": "digest", "provider": "ollama", "chat_model": "qwen2.5:7b"}
        result = runner_mod._get_chat_provider("digest", record)

        assert result == "fake-provider"
        assert fake.calls == [("digest", "ollama", "qwen2.5:7b")]

    def test_missing_record_fields_pass_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from agents import runner as runner_mod

        fake = _FakeRegistry()
        monkeypatch.setattr("core.providers.get_registry", lambda: fake)

        result = runner_mod._get_chat_provider("digest", {"id": "digest"})

        assert result == "fake-provider"
        assert fake.calls == [("digest", None, None)]

    def test_registry_failure_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from agents import runner as runner_mod

        def boom() -> None:
            raise RuntimeError("no registry")

        monkeypatch.setattr("core.providers.get_registry", boom)
        assert runner_mod._get_chat_provider("digest", {}) is None


# ---------------------------------------------------------------------------
# /api/settings/agent-models
# ---------------------------------------------------------------------------


def _init_vault(client: TestClient) -> None:
    client.post("/api/vaults", json={"name": "test"})


class TestAgentModelsEndpoint:
    def test_get_lists_builtins_with_overrides(self, client: TestClient, tmp_path: Path) -> None:
        _init_vault(client)
        cfg = _ollama_config(
            agent_models={"weaver": AgentModelOverride(provider="ollama", chat_model="qwen2.5:7b")}
        )
        cfg_path = _save_config(tmp_path, cfg)

        with patch("api.routers.agent_models.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            resp = client.get("/api/settings/agent-models")

        assert resp.status_code == 200
        data = resp.json()
        assert data["default_provider"] == "ollama"
        by_id = {a["id"]: a for a in data["agents"]}
        assert len(by_id) >= 7
        assert by_id["weaver"]["provider"] == "ollama"
        assert by_id["weaver"]["chat_model"] == "qwen2.5:7b"
        assert by_id["weaver"]["system"] is True
        assert by_id["spider"]["provider"] == ""
        assert by_id["spider"]["chat_model"] == ""

    def test_get_reports_customs_without_promoting_record_fields(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """agents.yaml record fields must NOT surface as override values.

        GET's payload round-trips back through PUT as the full override map;
        if the record binding were merged in here, one save in the settings
        card would promote it to an agent_models override that then shadows
        later edits made in the Board's agent modal. The record still binds
        at run time via runner._get_chat_provider's fallback chain.
        """
        _init_vault(client)
        client.post(
            "/api/agents/registry",
            json={"name": "Digest", "provider": "ollama", "chat_model": "mistral:7b"},
        )
        # Keep the vault created above active: _save_config overwrites the
        # config.yaml the vault POST wrote, and active_vault defaults to
        # "default", which would point the loader at an empty vault.
        cfg_path = _save_config(tmp_path, _ollama_config(active_vault="test"))

        with patch("api.routers.agent_models.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            data = client.get("/api/settings/agent-models").json()

        digest = next(a for a in data["agents"] if a["id"] == "digest")
        assert digest["system"] is False
        assert digest["provider"] == ""
        assert digest["chat_model"] == ""

    def test_get_prefers_agent_models_over_record_fields(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        _init_vault(client)
        client.post(
            "/api/agents/registry",
            json={"name": "Digest", "provider": "ollama", "chat_model": "mistral:7b"},
        )
        cfg = _ollama_config(
            active_vault="test",
            agent_models={"digest": AgentModelOverride(provider="openai", chat_model="gpt-4o")},
        )
        cfg_path = _save_config(tmp_path, cfg)

        with patch("api.routers.agent_models.settings") as mock_settings:
            mock_settings.config_path = cfg_path
            data = client.get("/api/settings/agent-models").json()

        digest = next(a for a in data["agents"] if a["id"] == "digest")
        assert digest["provider"] == "openai"
        assert digest["chat_model"] == "gpt-4o"

    def test_put_round_trip_persists_and_reinits(self, client: TestClient, tmp_path: Path) -> None:
        _init_vault(client)
        cfg_path = _save_config(tmp_path, _ollama_config())

        with (
            patch("api.routers.agent_models.settings") as mock_settings,
            patch("api.runtime.reinit_providers_dependent_services") as mock_reinit,
        ):
            mock_settings.config_path = cfg_path
            resp = client.put(
                "/api/settings/agent-models",
                json={
                    "overrides": {
                        "weaver": {"provider": "ollama", "chat_model": "qwen2.5:7b"},
                        "scribe": {"provider": None, "chat_model": "llama3.1:8b"},
                        "spider": {"provider": "", "chat_model": ""},  # dropped
                    }
                },
            )

        assert resp.status_code == 200
        mock_reinit.assert_called_once()
        data = resp.json()
        by_id = {a["id"]: a for a in data["agents"]}
        assert by_id["weaver"]["chat_model"] == "qwen2.5:7b"
        assert by_id["scribe"]["provider"] == ""
        assert by_id["scribe"]["chat_model"] == "llama3.1:8b"
        assert by_id["spider"]["chat_model"] == ""

        saved = yaml.safe_load(cfg_path.read_text())
        assert saved["agent_models"]["weaver"]["chat_model"] == "qwen2.5:7b"
        assert saved["agent_models"]["scribe"]["chat_model"] == "llama3.1:8b"
        assert "spider" not in saved["agent_models"]

    def test_put_unknown_provider_422(self, client: TestClient, tmp_path: Path) -> None:
        _init_vault(client)
        cfg_path = _save_config(tmp_path, _ollama_config())

        with (
            patch("api.routers.agent_models.settings") as mock_settings,
            patch("api.runtime.reinit_providers_dependent_services") as mock_reinit,
        ):
            mock_settings.config_path = cfg_path
            resp = client.put(
                "/api/settings/agent-models",
                json={"overrides": {"weaver": {"provider": "skynet", "chat_model": "t-800"}}},
            )

        assert resp.status_code == 422
        mock_reinit.assert_not_called()
        # Config untouched on validation failure.
        saved = yaml.safe_load(cfg_path.read_text())
        assert not saved.get("agent_models")

    def test_put_empty_overrides_clears_all(self, client: TestClient, tmp_path: Path) -> None:
        _init_vault(client)
        cfg = _ollama_config(agent_models={"weaver": AgentModelOverride(chat_model="qwen2.5:7b")})
        cfg_path = _save_config(tmp_path, cfg)

        with (
            patch("api.routers.agent_models.settings") as mock_settings,
            patch("api.runtime.reinit_providers_dependent_services"),
        ):
            mock_settings.config_path = cfg_path
            resp = client.put("/api/settings/agent-models", json={"overrides": {}})

        assert resp.status_code == 200
        loaded = GlobalConfig.load(cfg_path)
        assert loaded.agent_models == {}

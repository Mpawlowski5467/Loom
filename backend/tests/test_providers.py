"""Tests for the provider system in core/providers.py."""

from unittest.mock import patch

import pytest

from core.config import GlobalConfig, ProviderConfig
from core.exceptions import ProviderConfigError
from core.providers import (
    AnthropicProvider,
    OllamaProvider,
    OpenAIProvider,
    ProviderRegistry,
    XAIProvider,
)


def _make_config(
    providers: dict[str, dict] | None = None,
    default_provider: str = "openai",
    embed_provider: str | None = None,
    chat_provider: str | None = None,
) -> GlobalConfig:
    """Build a GlobalConfig with provider entries for testing."""
    raw = providers or {}
    provider_configs = {name: ProviderConfig(**vals) for name, vals in raw.items()}
    return GlobalConfig(
        providers=provider_configs,
        embed_provider=embed_provider,
        chat_provider=chat_provider,
    )


# ---------------------------------------------------------------------------
# ProviderRegistry initialization
# ---------------------------------------------------------------------------


class TestRegistryInit:
    def test_creates_from_global_config(self) -> None:
        """ProviderRegistry can be created from a GlobalConfig."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)
        assert registry is not None

    def test_empty_providers(self) -> None:
        """Registry works with empty provider dict."""
        cfg = _make_config(providers={})
        registry = ProviderRegistry(cfg)
        assert registry is not None


# ---------------------------------------------------------------------------
# get() — valid provider
# ---------------------------------------------------------------------------


class TestRegistryGetValid:
    def test_get_ollama_provider(self) -> None:
        """get('ollama') returns an OllamaProvider instance."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")

        assert isinstance(provider, OllamaProvider)
        assert provider.name == "ollama"

    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-key"})
    def test_get_openai_provider(self) -> None:
        """get('openai') returns an OpenAIProvider when API key is set."""
        cfg = _make_config(providers={"openai": {"api_key": "sk-test-key", "chat_model": "gpt-4o"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("openai")

        assert isinstance(provider, OpenAIProvider)
        assert provider.name == "openai"

    @patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-test"})
    def test_get_anthropic_provider(self) -> None:
        """get('anthropic') returns an AnthropicProvider when API key is set."""
        cfg = _make_config(providers={"anthropic": {"api_key": "sk-ant-test"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("anthropic")

        assert isinstance(provider, AnthropicProvider)
        assert provider.name == "anthropic"

    @patch.dict("os.environ", {"XAI_API_KEY": "xai-test-key"})
    def test_get_xai_provider(self) -> None:
        """get('xai') returns an XAIProvider when API key is set."""
        cfg = _make_config(providers={"xai": {"api_key": "xai-test-key"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("xai")

        assert isinstance(provider, XAIProvider)
        assert provider.name == "xai"


# ---------------------------------------------------------------------------
# get() — invalid / missing provider
# ---------------------------------------------------------------------------


class TestRegistryGetInvalid:
    def test_get_unconfigured_provider_raises(self) -> None:
        """get() with a name not in config raises ProviderConfigError."""
        cfg = _make_config(providers={})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="not configured"):
            registry.get("openai")

    def test_get_unknown_provider_type_raises(self) -> None:
        """get() with an unsupported provider name raises ProviderConfigError."""
        cfg = _make_config(providers={"foobar": {"api_key": "test"}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="Unknown provider"):
            registry.get("foobar")


# ---------------------------------------------------------------------------
# Provider caching
# ---------------------------------------------------------------------------


class TestRegistryCaching:
    def test_get_returns_same_instance(self) -> None:
        """Subsequent get() calls return the cached provider instance."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        p1 = registry.get("ollama")
        p2 = registry.get("ollama")

        assert p1 is p2


# ---------------------------------------------------------------------------
# Default / embed / chat provider resolution
# ---------------------------------------------------------------------------


class TestProviderResolution:
    def test_get_embed_provider_falls_back_to_default(self) -> None:
        """get_embed_provider() uses the default provider when no explicit embed_provider."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        # Patch _default_name to return 'ollama'
        with patch.object(registry, "_default_name", return_value="ollama"):
            provider = registry.get_embed_provider()

        assert isinstance(provider, OllamaProvider)

    def test_get_chat_provider_falls_back_to_default(self) -> None:
        """get_chat_provider() uses the default provider when no explicit chat_provider."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        with patch.object(registry, "_default_name", return_value="ollama"):
            provider = registry.get_chat_provider()

        assert isinstance(provider, OllamaProvider)

    def test_explicit_embed_provider(self) -> None:
        """get_embed_provider() uses the explicit embed_provider when set."""
        cfg = _make_config(
            providers={"ollama": {"host": "http://localhost:11434"}},
            embed_provider="ollama",
        )
        registry = ProviderRegistry(cfg)

        provider = registry.get_embed_provider()

        assert isinstance(provider, OllamaProvider)

    def test_explicit_chat_provider(self) -> None:
        """get_chat_provider() uses the explicit chat_provider when set."""
        cfg = _make_config(
            providers={"ollama": {"host": "http://localhost:11434"}},
            chat_provider="ollama",
        )
        registry = ProviderRegistry(cfg)

        provider = registry.get_chat_provider()

        assert isinstance(provider, OllamaProvider)


# ---------------------------------------------------------------------------
# API key validation
# ---------------------------------------------------------------------------


class TestProviderApiKeyValidation:
    @patch.dict("os.environ", {}, clear=True)
    def test_openai_missing_api_key_raises(self) -> None:
        """OpenAI provider without API key (env or config) raises ProviderConfigError."""
        cfg = _make_config(providers={"openai": {}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="API key not set"):
            registry.get("openai")

    @patch.dict("os.environ", {}, clear=True)
    def test_anthropic_missing_api_key_raises(self) -> None:
        """Anthropic provider without API key raises ProviderConfigError."""
        cfg = _make_config(providers={"anthropic": {}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="API key not set"):
            registry.get("anthropic")

    @patch.dict("os.environ", {}, clear=True)
    def test_xai_missing_api_key_raises(self) -> None:
        """xAI provider without API key raises ProviderConfigError."""
        cfg = _make_config(providers={"xai": {}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="API key not set"):
            registry.get("xai")

    def test_ollama_does_not_require_api_key(self) -> None:
        """Ollama provider doesn't need an API key — just a host."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")

        assert isinstance(provider, OllamaProvider)


# ---------------------------------------------------------------------------
# OllamaProvider httpx client reuse
# ---------------------------------------------------------------------------


class TestOllamaClientReuse:
    def test_ollama_reuses_httpx_client(self) -> None:
        """OllamaProvider stores a single httpx.AsyncClient internally."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")
        assert isinstance(provider, OllamaProvider)

        # The internal client should be the same object on repeated access
        client1 = provider._client
        client2 = provider._client
        assert client1 is client2


# ---------------------------------------------------------------------------
# Registry close
# ---------------------------------------------------------------------------


class TestRegistryClose:
    @pytest.mark.asyncio
    async def test_close_calls_provider_close(self) -> None:
        """close() calls close() on providers that have it (e.g. Ollama)."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")
        assert isinstance(provider, OllamaProvider)

        # Patch the close method
        close_called = False

        async def mock_close():
            nonlocal close_called
            close_called = True

        provider.close = mock_close
        await registry.close()

        assert close_called

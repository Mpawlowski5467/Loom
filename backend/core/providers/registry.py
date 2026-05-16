"""Provider registry: loads configs and builds provider instances."""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends

from core.config import GlobalConfig, settings
from core.exceptions import ProviderConfigError
from core.providers.anthropic import AnthropicProvider
from core.providers.base import (
    AnthropicProviderConfig,
    BaseProvider,
    OllamaProviderConfig,
    OpenAIProviderConfig,
    XAIProviderConfig,
)
from core.providers.ollama import OllamaProvider
from core.providers.openai import OpenAIProvider
from core.providers.xai import XAIProvider

if TYPE_CHECKING:
    from pydantic import BaseModel

_CONFIG_MODEL_MAP: dict[str, type[BaseModel]] = {
    "openai": OpenAIProviderConfig,
    "anthropic": AnthropicProviderConfig,
    "ollama": OllamaProviderConfig,
    "xai": XAIProviderConfig,
}

_PROVIDER_CLASS_MAP: dict[str, type[BaseProvider]] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "ollama": OllamaProvider,
    "xai": XAIProvider,
}


class ProviderRegistry:
    """Loads provider configs from GlobalConfig and builds provider instances."""

    def __init__(self, global_config: GlobalConfig) -> None:
        self._global_config = global_config
        self._providers: dict[str, BaseProvider] = {}

    def _resolve_config(self, name: str) -> BaseModel:
        """Parse the raw ProviderConfig into a typed config model."""
        raw = self._global_config.providers.get(name)
        if raw is None:
            raise ProviderConfigError(f"Provider '{name}' is not configured in config.yaml.")
        config_cls = _CONFIG_MODEL_MAP.get(name)
        if config_cls is None:
            raise ProviderConfigError(
                f"Unknown provider '{name}'. Supported: {', '.join(_CONFIG_MODEL_MAP)}."
            )
        return config_cls.model_validate(raw.model_dump(exclude_none=True))

    def get(self, name: str) -> BaseProvider:
        """Return a cached provider instance by name."""
        if name not in self._providers:
            cfg = self._resolve_config(name)
            provider_cls = _PROVIDER_CLASS_MAP[name]
            # Each provider class takes its specific *ProviderConfig in __init__;
            # BaseProvider itself takes none, so mypy can't see the call signature.
            self._providers[name] = provider_cls(cfg)  # type: ignore[call-arg]
        return self._providers[name]

    def get_embed_provider(self) -> BaseProvider:
        """Return the provider configured for embeddings.

        Checks for an explicit ``embed_provider`` key in the global config,
        falls back to the default provider.
        """
        return self.get(self._embed_provider_name())

    def get_chat_provider(self) -> BaseProvider:
        """Return the provider configured for chat.

        Checks for an explicit ``chat_provider`` key in the global config,
        falls back to the default provider.
        """
        return self.get(self._chat_provider_name())

    def _embed_provider_name(self) -> str:
        raw = self._global_config.model_dump()
        return raw.get("embed_provider") or self._default_name()

    def _chat_provider_name(self) -> str:
        raw = self._global_config.model_dump()
        return raw.get("chat_provider") or self._default_name()

    async def close(self) -> None:
        """Close any providers that hold resources (e.g. httpx clients)."""
        for provider in self._providers.values():
            if hasattr(provider, "close"):
                await provider.close()

    def _default_name(self) -> str:
        return settings.default_provider


# ---------------------------------------------------------------------------
# Module-level singleton + FastAPI dependencies
# ---------------------------------------------------------------------------

_registry: ProviderRegistry | None = None


def get_registry() -> ProviderRegistry:
    """Return (and lazily create) the global ProviderRegistry."""
    global _registry
    if _registry is None:
        global_config = GlobalConfig.load(settings.config_path)
        _registry = ProviderRegistry(global_config)
    return _registry


async def reset_registry() -> None:
    """Force re-creation of the registry (useful after config changes).

    Closes any provider clients first so we don't leak httpx connections.
    Best-effort: any close failure is swallowed so the registry slot
    is always cleared.
    """
    global _registry
    if _registry is not None:
        with contextlib.suppress(Exception):
            await _registry.close()
    _registry = None


def get_embed_provider() -> BaseProvider:
    """FastAPI dependency that returns the configured embedding provider."""
    return get_registry().get_embed_provider()


def get_chat_provider() -> BaseProvider:
    """FastAPI dependency that returns the configured chat provider."""
    return get_registry().get_chat_provider()


EmbedProvider = Annotated[BaseProvider, Depends(get_embed_provider)]
ChatProvider = Annotated[BaseProvider, Depends(get_chat_provider)]

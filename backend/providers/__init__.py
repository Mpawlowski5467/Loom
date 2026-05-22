"""Provider package — adapters for chat/embed LLM providers.

Each provider implements :class:`BaseProvider`. They are registered in
``_REGISTRY`` and dispatched via :func:`get_provider`.
"""

from __future__ import annotations

from core.config import ProviderConfig
from core.exceptions import UnknownProviderError
from providers.anthropic import AnthropicProvider
from providers.base import BaseProvider, ModelInfo, TestProviderResponse
from providers.ollama import OllamaProvider
from providers.openai import OpenAIProvider
from providers.xai import XAIProvider

_REGISTRY: dict[str, type[BaseProvider]] = {
    OpenAIProvider.name: OpenAIProvider,
    AnthropicProvider.name: AnthropicProvider,
    XAIProvider.name: XAIProvider,
    OllamaProvider.name: OllamaProvider,
}


def known_provider_names() -> list[str]:
    return list(_REGISTRY.keys())


def get_provider(name: str, config: ProviderConfig) -> BaseProvider:
    """Look up a provider by name and instantiate it against ``config``."""
    cls = _REGISTRY.get(name)
    if cls is None:
        raise UnknownProviderError(name)
    return cls(config)


__all__ = [
    "BaseProvider",
    "ModelInfo",
    "TestProviderResponse",
    "get_provider",
    "known_provider_names",
]

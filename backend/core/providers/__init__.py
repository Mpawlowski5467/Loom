"""Provider-agnostic AI configuration layer.

Public re-exports keep ``from core.providers import …`` working for all
existing callers. Implementation is split across:

- ``core.providers.base``      — abstract BaseProvider and config models
- ``core.providers.openai``    — OpenAIProvider
- ``core.providers.anthropic`` — AnthropicProvider
- ``core.providers.ollama``    — OllamaProvider
- ``core.providers.xai``       — XAIProvider
- ``core.providers.registry``  — ProviderRegistry, get/reset, FastAPI deps
"""

from __future__ import annotations

from core.providers.anthropic import AnthropicProvider, AnthropicProviderConfig
from core.providers.base import BaseProvider
from core.providers.ollama import OllamaProvider, OllamaProviderConfig
from core.providers.openai import OpenAIProvider, OpenAIProviderConfig
from core.providers.registry import (
    ChatProvider,
    EmbedProvider,
    ProviderRegistry,
    get_chat_provider,
    get_embed_provider,
    get_registry,
    reset_registry,
)
from core.providers.xai import XAIProvider, XAIProviderConfig

__all__ = [
    "AnthropicProvider",
    "AnthropicProviderConfig",
    "BaseProvider",
    "ChatProvider",
    "EmbedProvider",
    "OllamaProvider",
    "OllamaProviderConfig",
    "OpenAIProvider",
    "OpenAIProviderConfig",
    "ProviderRegistry",
    "XAIProvider",
    "XAIProviderConfig",
    "get_chat_provider",
    "get_embed_provider",
    "get_registry",
    "reset_registry",
]

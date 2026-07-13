"""Provider-agnostic AI configuration layer.

Public re-exports keep ``from core.providers import …`` working for all
existing callers. Implementation is split across:

- ``core.providers.base``      — abstract BaseProvider and config models
- ``core.providers.openai``    — OpenAIProvider
- ``core.providers.anthropic`` — AnthropicProvider
- ``core.providers.ollama``    — OllamaProvider
- ``core.providers.xai``       — XAIProvider
- ``core.providers.openrouter`` — OpenRouterProvider
- ``core.providers.cached``    — CachedProvider (optional Redis response cache)
- ``core.providers.registry``  — ProviderRegistry, get/reset, FastAPI deps
"""

from __future__ import annotations

from core.providers.anthropic import AnthropicProvider
from core.providers.base import (
    AnthropicProviderConfig,
    BaseProvider,
    CodexProviderConfig,
    OllamaProviderConfig,
    OpenAIProviderConfig,
    OpenRouterProviderConfig,
    XAIProviderConfig,
)
from core.providers.cached import CachedProvider
from core.providers.codex import (
    CodexConnectionStatus,
    CodexLoginStart,
    CodexProvider,
    codex_connection_status,
    start_codex_login,
)
from core.providers.ollama import OllamaProvider
from core.providers.openai import OpenAIProvider
from core.providers.openrouter import OpenRouterProvider
from core.providers.registry import (
    ChatProvider,
    EmbedProvider,
    ProviderRegistry,
    TracedProvider,
    get_chat_provider,
    get_embed_provider,
    get_registry,
    reset_registry,
    unwrap_provider,
)
from core.providers.xai import XAIProvider

__all__ = [
    "AnthropicProvider",
    "AnthropicProviderConfig",
    "BaseProvider",
    "CachedProvider",
    "ChatProvider",
    "CodexConnectionStatus",
    "CodexLoginStart",
    "CodexProvider",
    "CodexProviderConfig",
    "EmbedProvider",
    "OllamaProvider",
    "OllamaProviderConfig",
    "OpenAIProvider",
    "OpenAIProviderConfig",
    "OpenRouterProvider",
    "OpenRouterProviderConfig",
    "ProviderRegistry",
    "TracedProvider",
    "XAIProvider",
    "XAIProviderConfig",
    "codex_connection_status",
    "get_chat_provider",
    "get_embed_provider",
    "get_registry",
    "reset_registry",
    "start_codex_login",
    "unwrap_provider",
]

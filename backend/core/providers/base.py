"""Base provider interface and per-provider config models."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel


class OpenAIProviderConfig(BaseModel):
    """OpenAI provider settings."""

    api_key: str | None = None
    chat_model: str = "gpt-4o"
    embed_model: str = "text-embedding-3-small"


class AnthropicProviderConfig(BaseModel):
    """Anthropic provider settings."""

    api_key: str | None = None
    chat_model: str = "claude-sonnet-4-20250514"


class OllamaProviderConfig(BaseModel):
    """Ollama (local) provider settings."""

    host: str = "http://localhost:11434"
    chat_model: str = "llama3"
    embed_model: str = "nomic-embed-text"


class CodexProviderConfig(BaseModel):
    """Codex local app-server bridge settings.

    Authentication is owned by Codex in Loom's isolated Codex home, not by
    Loom's provider config. ``default`` means to use Codex's recommended model.
    """

    chat_model: str = "default"


class XAIProviderConfig(BaseModel):
    """xAI (OpenAI-compatible) provider settings."""

    api_key: str | None = None
    base_url: str = "https://api.x.ai/v1"
    chat_model: str = "grok-3"
    embed_model: str | None = None


class OpenRouterProviderConfig(BaseModel):
    """OpenRouter (OpenAI-compatible aggregator) provider settings.

    Chat-only — OpenRouter does not expose an embeddings endpoint.
    """

    api_key: str | None = None
    base_url: str = "https://openrouter.ai/api/v1"
    chat_model: str = "openai/gpt-4o-mini"


class OpenAICompatProviderConfig(BaseModel):
    """Settings shared by OpenAI-compatible providers (Groq, DeepSeek, Together,
    Mistral, Gemini).

    ``base_url`` defaults to empty here; each provider class fills in its own
    hosted endpoint when the value is blank. ``embed_model`` is optional — most
    of these vendors are chat-only, but Mistral and Gemini support embeddings.
    """

    api_key: str | None = None
    base_url: str = ""
    chat_model: str = ""
    embed_model: str | None = None


class BaseProvider(ABC):
    """Unified interface for AI providers."""

    name: str

    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        """Return an embedding vector for *text*."""

    @abstractmethod
    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        """Return a chat completion string."""

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        system: str = "",
    ) -> AsyncIterator[str]:
        """Yield chunks of a chat completion as they arrive.

        Default implementation buffers via :meth:`chat` and yields once at the
        end — providers that natively support streaming should override.
        """
        text = await self.chat(messages=messages, system=system)
        yield text

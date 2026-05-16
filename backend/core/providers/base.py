"""Base provider interface and per-provider config models."""

from __future__ import annotations

from abc import ABC, abstractmethod
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


class XAIProviderConfig(BaseModel):
    """xAI (OpenAI-compatible) provider settings."""

    api_key: str | None = None
    base_url: str = "https://api.x.ai/v1"
    chat_model: str = "grok-3"
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

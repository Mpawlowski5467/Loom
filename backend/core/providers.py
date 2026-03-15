"""Provider-agnostic AI configuration layer.

Loads provider configs from ~/.loom/config.yaml, exposes a unified
BaseProvider interface with embed() and chat() methods, and provides
FastAPI dependency helpers.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Annotated

import anthropic
import httpx
import openai
from fastapi import Depends
from pydantic import BaseModel

from core.config import GlobalConfig, settings
from core.exceptions import ProviderConfigError, ProviderError

# ---------------------------------------------------------------------------
# Provider config models
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Base provider interface
# ---------------------------------------------------------------------------


class BaseProvider(ABC):
    """Unified interface for AI providers."""

    name: str

    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        """Return an embedding vector for *text*."""

    @abstractmethod
    async def chat(self, messages: list[dict], system: str = "") -> str:
        """Return a chat completion string."""


# ---------------------------------------------------------------------------
# Concrete implementations
# ---------------------------------------------------------------------------


class OpenAIProvider(BaseProvider):
    """OpenAI / OpenAI-compatible provider."""

    name = "openai"

    def __init__(self, cfg: OpenAIProviderConfig) -> None:
        api_key = cfg.api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ProviderConfigError(
                "OpenAI API key not set. Provide it in config.yaml or "
                "set the OPENAI_API_KEY environment variable."
            )
        self._client = openai.AsyncOpenAI(api_key=api_key)
        self._chat_model = cfg.chat_model
        self._embed_model = cfg.embed_model

    async def embed(self, text: str) -> list[float]:
        """Generate an embedding via the OpenAI embeddings API."""
        try:
            resp = await self._client.embeddings.create(
                model=self._embed_model,
                input=text,
            )
            return resp.data[0].embedding
        except openai.OpenAIError as exc:
            raise ProviderError("openai", str(exc)) from exc

    async def chat(self, messages: list[dict], system: str = "") -> str:
        """Generate a chat completion via the OpenAI chat API."""
        full_messages: list[dict] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        try:
            resp = await self._client.chat.completions.create(
                model=self._chat_model,
                messages=full_messages,
            )
            return resp.choices[0].message.content or ""
        except openai.OpenAIError as exc:
            raise ProviderError("openai", str(exc)) from exc


class AnthropicProvider(BaseProvider):
    """Anthropic Claude provider."""

    name = "anthropic"

    def __init__(self, cfg: AnthropicProviderConfig) -> None:
        api_key = cfg.api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ProviderConfigError(
                "Anthropic API key not set. Provide it in config.yaml or "
                "set the ANTHROPIC_API_KEY environment variable."
            )
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._chat_model = cfg.chat_model

    async def embed(self, text: str) -> list[float]:
        """Anthropic does not offer an embeddings API."""
        raise ProviderError(
            "anthropic",
            "Anthropic does not provide an embeddings endpoint. "
            "Configure a different provider for embeddings.",
        )

    async def chat(self, messages: list[dict], system: str = "") -> str:
        """Generate a chat completion via the Anthropic messages API."""
        try:
            resp = await self._client.messages.create(
                model=self._chat_model,
                max_tokens=4096,
                system=system or anthropic.NOT_GIVEN,
                messages=messages,
            )
            return resp.content[0].text
        except anthropic.APIError as exc:
            raise ProviderError("anthropic", str(exc)) from exc


class OllamaProvider(BaseProvider):
    """Ollama local provider — communicates over HTTP."""

    name = "ollama"

    def __init__(self, cfg: OllamaProviderConfig) -> None:
        self._host = cfg.host.rstrip("/")
        self._chat_model = cfg.chat_model
        self._embed_model = cfg.embed_model

    async def embed(self, text: str) -> list[float]:
        """Generate an embedding via the Ollama API."""
        async with httpx.AsyncClient(timeout=60) as client:
            try:
                resp = await client.post(
                    f"{self._host}/api/embed",
                    json={"model": self._embed_model, "input": text},
                )
                resp.raise_for_status()
                data = resp.json()
                return data["embeddings"][0]
            except httpx.HTTPError as exc:
                raise ProviderError("ollama", str(exc)) from exc

    async def chat(self, messages: list[dict], system: str = "") -> str:
        """Generate a chat completion via the Ollama API."""
        full_messages: list[dict] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        async with httpx.AsyncClient(timeout=120) as client:
            try:
                resp = await client.post(
                    f"{self._host}/api/chat",
                    json={
                        "model": self._chat_model,
                        "messages": full_messages,
                        "stream": False,
                    },
                )
                resp.raise_for_status()
                return resp.json()["message"]["content"]
            except httpx.HTTPError as exc:
                raise ProviderError("ollama", str(exc)) from exc


class XAIProvider(BaseProvider):
    """xAI provider — uses the OpenAI-compatible API."""

    name = "xai"

    def __init__(self, cfg: XAIProviderConfig) -> None:
        api_key = cfg.api_key or os.getenv("XAI_API_KEY")
        if not api_key:
            raise ProviderConfigError(
                "xAI API key not set. Provide it in config.yaml or "
                "set the XAI_API_KEY environment variable."
            )
        self._client = openai.AsyncOpenAI(
            api_key=api_key, base_url=cfg.base_url
        )
        self._chat_model = cfg.chat_model
        self._embed_model = cfg.embed_model

    async def embed(self, text: str) -> list[float]:
        """Generate an embedding via xAI's OpenAI-compatible API."""
        if not self._embed_model:
            raise ProviderError(
                "xai", "No embed_model configured for xAI provider."
            )
        try:
            resp = await self._client.embeddings.create(
                model=self._embed_model,
                input=text,
            )
            return resp.data[0].embedding
        except openai.OpenAIError as exc:
            raise ProviderError("xai", str(exc)) from exc

    async def chat(self, messages: list[dict], system: str = "") -> str:
        """Generate a chat completion via xAI's OpenAI-compatible API."""
        full_messages: list[dict] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        try:
            resp = await self._client.chat.completions.create(
                model=self._chat_model,
                messages=full_messages,
            )
            return resp.choices[0].message.content or ""
        except openai.OpenAIError as exc:
            raise ProviderError("xai", str(exc)) from exc


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------


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
        self._default = global_config.providers.get("default")  # type: ignore[arg-type]
        self._providers: dict[str, BaseProvider] = {}

    def _resolve_config(self, name: str) -> BaseModel:
        """Parse the raw ProviderConfig into a typed config model."""
        raw = self._global_config.providers.get(name)
        if raw is None:
            raise ProviderConfigError(
                f"Provider '{name}' is not configured in config.yaml."
            )
        config_cls = _CONFIG_MODEL_MAP.get(name)
        if config_cls is None:
            raise ProviderConfigError(
                f"Unknown provider '{name}'. "
                f"Supported: {', '.join(_CONFIG_MODEL_MAP)}."
            )
        return config_cls.model_validate(raw.model_dump(exclude_none=True))

    def get(self, name: str) -> BaseProvider:
        """Return a cached provider instance by name."""
        if name not in self._providers:
            cfg = self._resolve_config(name)
            provider_cls = _PROVIDER_CLASS_MAP[name]
            self._providers[name] = provider_cls(cfg)  # type: ignore[arg-type]
        return self._providers[name]

    def get_embed_provider(self) -> BaseProvider:
        """Return the provider configured for embeddings.

        Checks for an explicit ``embed_provider`` key in the global config,
        falls back to the default provider.
        """
        name = self._embed_provider_name()
        return self.get(name)

    def get_chat_provider(self) -> BaseProvider:
        """Return the provider configured for chat.

        Checks for an explicit ``chat_provider`` key in the global config,
        falls back to the default provider.
        """
        name = self._chat_provider_name()
        return self.get(name)

    def _embed_provider_name(self) -> str:
        raw = self._global_config.model_dump()
        name = raw.get("embed_provider") or self._default_name()
        return name

    def _chat_provider_name(self) -> str:
        raw = self._global_config.model_dump()
        name = raw.get("chat_provider") or self._default_name()
        return name

    def _default_name(self) -> str:
        if self._default and isinstance(self._default, str):
            return self._default
        # Infer from settings
        return settings.default_provider


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_registry: ProviderRegistry | None = None


def get_registry() -> ProviderRegistry:
    """Return (and lazily create) the global ProviderRegistry."""
    global _registry
    if _registry is None:
        global_config = GlobalConfig.load(settings.config_path)
        _registry = ProviderRegistry(global_config)
    return _registry


def reset_registry() -> None:
    """Force re-creation of the registry (useful after config changes)."""
    global _registry
    _registry = None


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


def get_embed_provider() -> BaseProvider:
    """FastAPI dependency that returns the configured embedding provider."""
    return get_registry().get_embed_provider()


def get_chat_provider() -> BaseProvider:
    """FastAPI dependency that returns the configured chat provider."""
    return get_registry().get_chat_provider()


EmbedProvider = Annotated[BaseProvider, Depends(get_embed_provider)]
ChatProvider = Annotated[BaseProvider, Depends(get_chat_provider)]

"""Shared implementation for OpenAI-compatible providers.

Several vendors expose an endpoint that speaks the OpenAI wire protocol, so the
client code is identical to :class:`~core.providers.openai.OpenAIProvider` apart
from the ``base_url`` and which env var holds the key. Rather than copy that
class per vendor (as the original ``xai``/``openrouter`` modules did), the new
providers — Groq, DeepSeek, Together, Mistral, Gemini — subclass
:class:`OpenAICompatibleProvider` and only declare their identity + defaults.
"""

from __future__ import annotations

import os
from typing import Any, cast

import openai
from openai.types.chat import ChatCompletionMessageParam

from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import BaseProvider, OpenAICompatProviderConfig


class OpenAICompatibleProvider(BaseProvider):
    """Base class for providers that speak the OpenAI API over a custom base_url.

    Subclasses set :attr:`name`, :attr:`env_key`, :attr:`label`, and
    :attr:`default_base_url`. Embeddings are supported only when the config
    carries an ``embed_model`` (most of these vendors are chat-only).
    """

    #: Provider id (matches the registry key and config.yaml section).
    name: str = "openai-compatible"
    #: Environment variable consulted when no api_key is in the config.
    env_key: str = ""
    #: Human label used in error messages.
    label: str = "OpenAI-compatible"
    #: Endpoint used when the config leaves base_url unset.
    default_base_url: str = ""
    #: Fallback chat model when the config leaves chat_model blank — keeps a
    #: pre-save "test this key" call working before a model has been chosen.
    default_chat_model: str = ""

    def __init__(self, cfg: OpenAICompatProviderConfig) -> None:
        api_key = cfg.api_key or (os.getenv(self.env_key) if self.env_key else None)
        if not api_key:
            env_hint = f" or set the {self.env_key} environment variable" if self.env_key else ""
            raise ProviderConfigError(
                f"{self.label} API key not set. Provide it in config.yaml{env_hint}."
            )
        self._client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url=cfg.base_url or self.default_base_url,
        )
        self._chat_model = cfg.chat_model or self.default_chat_model
        self._embed_model = cfg.embed_model

    async def close(self) -> None:
        """Close the underlying httpx client owned by AsyncOpenAI."""
        await self._client.close()

    async def embed(self, text: str) -> list[float]:
        """Generate an embedding via the vendor's OpenAI-compatible endpoint."""
        if not self._embed_model:
            raise ProviderError(self.name, f"No embed_model configured for {self.label}.")
        try:
            resp = await self._client.embeddings.create(model=self._embed_model, input=text)
            return resp.data[0].embedding
        except openai.OpenAIError as exc:
            raise ProviderError(self.name, str(exc)) from exc

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        """Generate a chat completion via the vendor's OpenAI-compatible endpoint."""
        full_messages: list[dict[str, Any]] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        try:
            resp = await self._client.chat.completions.create(
                model=self._chat_model,
                messages=cast(list[ChatCompletionMessageParam], full_messages),
            )
            return resp.choices[0].message.content or ""
        except openai.OpenAIError as exc:
            raise ProviderError(self.name, str(exc)) from exc


class GroqProvider(OpenAICompatibleProvider):
    """Groq — ultra-fast inference over an OpenAI-compatible API (chat-only)."""

    name = "groq"
    env_key = "GROQ_API_KEY"
    label = "Groq"
    default_base_url = "https://api.groq.com/openai/v1"
    default_chat_model = "llama-3.3-70b-versatile"


class DeepSeekProvider(OpenAICompatibleProvider):
    """DeepSeek — OpenAI-compatible API (chat-only)."""

    name = "deepseek"
    env_key = "DEEPSEEK_API_KEY"
    label = "DeepSeek"
    default_base_url = "https://api.deepseek.com/v1"
    default_chat_model = "deepseek-chat"


class TogetherProvider(OpenAICompatibleProvider):
    """Together AI — many open models over an OpenAI-compatible API."""

    name = "together"
    env_key = "TOGETHER_API_KEY"
    label = "Together AI"
    default_base_url = "https://api.together.xyz/v1"
    default_chat_model = "meta-llama/Llama-3.3-70B-Instruct-Turbo"


class MistralProvider(OpenAICompatibleProvider):
    """Mistral AI — OpenAI-compatible API (chat + embeddings)."""

    name = "mistral"
    env_key = "MISTRAL_API_KEY"
    label = "Mistral"
    default_base_url = "https://api.mistral.ai/v1"
    default_chat_model = "mistral-large-latest"


class GeminiProvider(OpenAICompatibleProvider):
    """Google Gemini — via its OpenAI-compatible endpoint (chat + embeddings)."""

    name = "gemini"
    env_key = "GEMINI_API_KEY"
    label = "Google Gemini"
    default_base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
    default_chat_model = "gemini-2.0-flash"

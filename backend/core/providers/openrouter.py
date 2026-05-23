"""OpenRouter provider implementation (uses the OpenAI-compatible API)."""

from __future__ import annotations

import os
from typing import Any, cast

import openai
from openai.types.chat import ChatCompletionMessageParam

from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import BaseProvider, OpenRouterProviderConfig


class OpenRouterProvider(BaseProvider):
    """OpenRouter provider — chat aggregator over an OpenAI-compatible API."""

    name = "openrouter"

    def __init__(self, cfg: OpenRouterProviderConfig) -> None:
        api_key = cfg.api_key or os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise ProviderConfigError(
                "OpenRouter API key not set. Provide it in config.yaml or "
                "set the OPENROUTER_API_KEY environment variable."
            )
        self._client = openai.AsyncOpenAI(api_key=api_key, base_url=cfg.base_url)
        self._chat_model = cfg.chat_model

    async def close(self) -> None:
        """Close the underlying httpx client owned by AsyncOpenAI."""
        await self._client.close()

    async def embed(self, text: str) -> list[float]:
        """OpenRouter has no embeddings endpoint — point at OpenAI/Ollama instead."""
        raise ProviderError(
            "openrouter",
            "OpenRouter does not support embeddings. Configure a separate "
            "embed provider (OpenAI or Ollama).",
        )

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        """Generate a chat completion via OpenRouter's OpenAI-compatible API."""
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
            raise ProviderError("openrouter", str(exc)) from exc

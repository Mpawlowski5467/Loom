"""OpenAI / OpenAI-compatible provider implementation."""

from __future__ import annotations

import os
from typing import Any, cast

import openai
from openai.types.chat import ChatCompletionMessageParam

from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import BaseProvider, OpenAIProviderConfig


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

    async def close(self) -> None:
        """Close the underlying httpx client owned by AsyncOpenAI."""
        await self._client.close()

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

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        """Generate a chat completion via the OpenAI chat API."""
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
            raise ProviderError("openai", str(exc)) from exc

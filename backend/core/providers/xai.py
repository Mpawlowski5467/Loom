"""xAI provider implementation (uses the OpenAI-compatible API)."""

from __future__ import annotations

import os

import openai

from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import BaseProvider, XAIProviderConfig


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
        self._client = openai.AsyncOpenAI(api_key=api_key, base_url=cfg.base_url)
        self._chat_model = cfg.chat_model
        self._embed_model = cfg.embed_model

    async def close(self) -> None:
        """Close the underlying httpx client owned by AsyncOpenAI."""
        await self._client.close()

    async def embed(self, text: str) -> list[float]:
        """Generate an embedding via xAI's OpenAI-compatible API."""
        if not self._embed_model:
            raise ProviderError("xai", "No embed_model configured for xAI provider.")
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

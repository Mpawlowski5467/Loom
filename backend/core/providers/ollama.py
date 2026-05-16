"""Ollama local provider implementation."""

from __future__ import annotations

from typing import Any

import httpx

from core.exceptions import ProviderError
from core.providers.base import BaseProvider, OllamaProviderConfig


class OllamaProvider(BaseProvider):
    """Ollama local provider — communicates over HTTP.

    Reuses a single httpx.AsyncClient for connection pooling.
    """

    name = "ollama"

    def __init__(self, cfg: OllamaProviderConfig) -> None:
        self._host = cfg.host.rstrip("/")
        self._chat_model = cfg.chat_model
        self._embed_model = cfg.embed_model
        self._client = httpx.AsyncClient(
            base_url=self._host,
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0),
        )

    async def close(self) -> None:
        """Close the underlying httpx client."""
        await self._client.aclose()

    async def embed(self, text: str) -> list[float]:
        """Generate an embedding via the Ollama API."""
        try:
            resp = await self._client.post(
                "/api/embed",
                json={"model": self._embed_model, "input": text},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()
            embedding: list[float] = data["embeddings"][0]
            return embedding
        except httpx.HTTPError as exc:
            raise ProviderError("ollama", str(exc)) from exc

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        """Generate a chat completion via the Ollama API."""
        full_messages: list[dict[str, Any]] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        try:
            resp = await self._client.post(
                "/api/chat",
                json={
                    "model": self._chat_model,
                    "messages": full_messages,
                    "stream": False,
                },
            )
            resp.raise_for_status()
            content: str = resp.json()["message"]["content"]
            return content
        except httpx.HTTPError as exc:
            raise ProviderError("ollama", str(exc)) from exc

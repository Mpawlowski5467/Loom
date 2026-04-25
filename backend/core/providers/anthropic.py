"""Anthropic Claude provider implementation."""

from __future__ import annotations

import os

import anthropic

from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import AnthropicProviderConfig, BaseProvider


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

    async def close(self) -> None:
        """Close the underlying httpx client owned by AsyncAnthropic."""
        await self._client.close()

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

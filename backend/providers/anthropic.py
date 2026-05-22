"""Anthropic provider adapter."""

from __future__ import annotations

import time
from typing import ClassVar

import httpx

from core.exceptions import ProviderError
from providers.base import BaseProvider, ModelInfo, TestProviderResponse

ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider(BaseProvider):
    name: ClassVar[str] = "anthropic"
    base_url: ClassVar[str] = "https://api.anthropic.com/v1"

    def _headers(self) -> dict[str, str]:
        if not self.config.api_key:
            raise ProviderError(self.name, "auth", "Missing API key")
        return {
            "x-api-key": self.config.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        }

    async def test(self) -> TestProviderResponse:
        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/models", headers=self._headers())
            latency = int((time.perf_counter() - start) * 1000)
            if resp.status_code in (401, 403):
                return TestProviderResponse(ok=False, latency_ms=latency, error="Invalid API key")
            resp.raise_for_status()
            return TestProviderResponse(ok=True, latency_ms=latency)
        except httpx.TimeoutException:
            return TestProviderResponse(ok=False, error="Request timed out")
        except httpx.HTTPError as exc:
            return TestProviderResponse(ok=False, error=str(exc))

    async def list_models(self) -> tuple[list[ModelInfo], list[ModelInfo]]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/models", headers=self._headers())
            resp.raise_for_status()
            data = resp.json().get("data", [])
        except httpx.HTTPError as exc:
            raise ProviderError(self.name, "network", str(exc)) from exc

        chat = [
            ModelInfo(
                id=row.get("id", ""),
                name=row.get("display_name", row.get("id", "")),
                type="chat",
            )
            for row in data
            if row.get("id")
        ]
        chat.sort(key=lambda m: m.id)
        return chat, []

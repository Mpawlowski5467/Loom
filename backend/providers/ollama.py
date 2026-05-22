"""Ollama provider adapter — local-only HTTP service, no API key."""

from __future__ import annotations

import socket
import time
from typing import ClassVar
from urllib.parse import urlparse

import httpx

from core.exceptions import ProviderError
from providers.base import BaseProvider, ModelInfo, TestProviderResponse

# Ollama-specific tighter timeouts: it's local, so a slow response usually
# means it isn't running.
OLLAMA_TIMEOUT = httpx.Timeout(connect=1.0, read=3.0, write=3.0, pool=1.0)
DEFAULT_HOST = "http://localhost:11434"


class OllamaProvider(BaseProvider):
    name: ClassVar[str] = "ollama"
    requires_api_key: ClassVar[bool] = False
    requires_host: ClassVar[bool] = True
    timeout: ClassVar[httpx.Timeout] = OLLAMA_TIMEOUT

    def _host(self) -> str:
        return (self.config.host or DEFAULT_HOST).rstrip("/")

    def _tcp_preflight(self) -> str | None:
        """Quick TCP open to fail fast when Ollama isn't listening."""
        parsed = urlparse(self._host())
        host = parsed.hostname or "localhost"
        port = parsed.port or (443 if parsed.scheme == "https" else 11434)
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return None
        except OSError as exc:
            return f"Ollama not reachable at {host}:{port} ({exc.__class__.__name__})"

    async def test(self) -> TestProviderResponse:
        pre = self._tcp_preflight()
        if pre:
            return TestProviderResponse(ok=False, error=pre)

        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self._host()}/api/tags")
            latency = int((time.perf_counter() - start) * 1000)
            resp.raise_for_status()
            return TestProviderResponse(ok=True, latency_ms=latency)
        except httpx.TimeoutException:
            return TestProviderResponse(ok=False, error="Ollama timed out")
        except httpx.HTTPError as exc:
            return TestProviderResponse(ok=False, error=str(exc))

    async def list_models(self) -> tuple[list[ModelInfo], list[ModelInfo]]:
        pre = self._tcp_preflight()
        if pre:
            raise ProviderError(self.name, "network", pre)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self._host()}/api/tags")
            resp.raise_for_status()
            payload = resp.json().get("models", [])
        except httpx.HTTPError as exc:
            raise ProviderError(self.name, "network", str(exc)) from exc

        chat: list[ModelInfo] = []
        embed: list[ModelInfo] = []
        for row in payload:
            model_id = row.get("name") or row.get("model", "")
            if not model_id:
                continue
            is_embed = "embed" in model_id.lower()
            info = ModelInfo(id=model_id, name=model_id, type="embed" if is_embed else "chat")
            (embed if is_embed else chat).append(info)
        chat.sort(key=lambda m: m.id)
        embed.sort(key=lambda m: m.id)
        return chat, embed

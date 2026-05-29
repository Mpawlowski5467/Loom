"""OpenRouter provider implementation (uses the OpenAI-compatible API)."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import AsyncIterator
from typing import Any, cast

import openai
from openai.types.chat import ChatCompletionMessageParam

from core.exceptions import ProviderConfigError, ProviderError
from core.providers.base import BaseProvider, OpenRouterProviderConfig

# Free OpenRouter models are rate-limited two ways: a per-MINUTE cap (~16 req)
# and a per-DAY cap (~50 req, resetting at 00:00 UTC). The multi-agent Council
# bursts several calls at once, so per-minute 429s are expected under load — we
# wait for the window to reset and retry. A per-DAY 429, by contrast, resets
# hours away: waiting is futile, so we fail fast with the real reason instead.
# The SDK's own retries are disabled (see __init__) so each logical attempt is
# exactly one request — we never amplify rate-limit usage.
_MAX_RETRIES = 3
_MAX_BACKOFF_S = 30.0  # cap on any single sleep, so the UI never hangs long
_RETRYABLE_HORIZON_S = 90.0  # resets further out than this => don't bother retrying


def _rate_limit_message(exc: openai.RateLimitError) -> str:
    """Pull OpenRouter's human-readable reason out of a 429 (falls back to str).

    The openai SDK unwraps the JSON ``error`` object into ``exc.body``, so the
    message sits at the top level; we still check a nested ``error`` as a guard.
    """
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        message = body.get("message")
        if not message:
            err = body.get("error")
            if isinstance(err, dict):
                message = err.get("message")
        if message:
            return f"OpenRouter: {message}"
    return f"OpenRouter rate limit: {exc}"


def _retry_delay_seconds(exc: openai.RateLimitError, attempt: int) -> float | None:
    """Seconds to wait before retrying a 429, or ``None`` if retrying is futile.

    Prefers the server's hints — ``Retry-After`` (seconds) or OpenRouter's
    ``X-RateLimit-Reset`` (epoch milliseconds). Returns ``None`` when the limit
    won't clear within ``_RETRYABLE_HORIZON_S`` (e.g. the per-day free cap), so
    the caller bails out immediately rather than stalling. Otherwise the wait is
    capped at ``_MAX_BACKOFF_S`` and walks down across attempts.
    """
    headers = getattr(getattr(exc, "response", None), "headers", None) or {}

    retry_after = headers.get("retry-after")
    if retry_after:
        try:
            secs = float(retry_after)
            return None if secs > _RETRYABLE_HORIZON_S else min(_MAX_BACKOFF_S, secs)
        except ValueError:
            pass

    reset_ms = headers.get("x-ratelimit-reset")
    if reset_ms:
        try:
            delay = float(reset_ms) / 1000.0 - time.time()
            if delay <= 0:
                return min(_MAX_BACKOFF_S, 2.0**attempt)
            if delay > _RETRYABLE_HORIZON_S:
                return None
            return min(_MAX_BACKOFF_S, delay + 0.5)
        except ValueError:
            pass

    return min(_MAX_BACKOFF_S, 2.0**attempt)


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
        # max_retries=0: our own 429 loop in chat() is the sole retry path, so
        # we don't fire extra requests that would burn the rate-limit budget.
        self._client = openai.AsyncOpenAI(api_key=api_key, base_url=cfg.base_url, max_retries=0)
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
        """Generate a chat completion, retrying through per-minute rate limits."""
        full_messages: list[dict[str, Any]] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)

        for attempt in range(_MAX_RETRIES + 1):
            try:
                resp = await self._client.chat.completions.create(
                    model=self._chat_model,
                    messages=cast(list[ChatCompletionMessageParam], full_messages),
                )
                return resp.choices[0].message.content or ""
            except openai.RateLimitError as exc:
                delay = _retry_delay_seconds(exc, attempt)
                if delay is None or attempt == _MAX_RETRIES:
                    raise ProviderError("openrouter", _rate_limit_message(exc)) from exc
                await asyncio.sleep(delay)
            except openai.OpenAIError as exc:
                raise ProviderError("openrouter", str(exc)) from exc

        # The loop always returns or raises; this satisfies type checkers.
        raise ProviderError("openrouter", "Exhausted retries unexpectedly.")

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        system: str = "",
    ) -> AsyncIterator[str]:
        """Stream a chat completion token-by-token, retrying through 429s.

        Mirrors :meth:`chat`'s rate-limit handling: only the initial request
        is retried (that's where per-minute limits surface). Once the stream is
        open, content deltas are yielded as they arrive; an error mid-stream is
        surfaced as a ``ProviderError`` rather than retried, since replaying a
        half-delivered response would double-count tokens.
        """
        full_messages: list[dict[str, Any]] = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)

        for attempt in range(_MAX_RETRIES + 1):
            try:
                stream = await self._client.chat.completions.create(
                    model=self._chat_model,
                    messages=cast(list[ChatCompletionMessageParam], full_messages),
                    stream=True,
                )
            except openai.RateLimitError as exc:
                delay = _retry_delay_seconds(exc, attempt)
                if delay is None or attempt == _MAX_RETRIES:
                    raise ProviderError("openrouter", _rate_limit_message(exc)) from exc
                await asyncio.sleep(delay)
                continue
            except openai.OpenAIError as exc:
                raise ProviderError("openrouter", str(exc)) from exc

            try:
                async for event in stream:
                    if not event.choices:
                        continue
                    delta = event.choices[0].delta.content
                    if delta:
                        yield delta
            except openai.OpenAIError as exc:
                raise ProviderError("openrouter", str(exc)) from exc
            return

        # The loop always returns or raises; this satisfies type checkers.
        raise ProviderError("openrouter", "Exhausted retries unexpectedly.")

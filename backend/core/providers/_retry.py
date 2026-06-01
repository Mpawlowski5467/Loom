"""Bounded retry helper for transient provider failures.

Used by :class:`TracedProvider` to retry ``chat``/``embed`` and the connection
phase of ``chat_stream`` on transient ``ProviderError`` (Ollama cold-start,
network blip, 429). Kept generic and tiny — provider-specific backoff (e.g.
OpenRouter's own 429 loop) lives in the provider and is excluded by the caller.
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar

from core.exceptions import ProviderError

T = TypeVar("T")

DEFAULT_ATTEMPTS = 3
DEFAULT_BASE_DELAY_S = 0.5
DEFAULT_MAX_DELAY_S = 8.0


async def with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = DEFAULT_ATTEMPTS,
    base_delay: float = DEFAULT_BASE_DELAY_S,
    max_delay: float = DEFAULT_MAX_DELAY_S,
) -> T:
    """Call ``fn`` with bounded retry on transient :class:`ProviderError`.

    Retries up to ``attempts`` total times (so ``attempts - 1`` re-tries),
    sleeping with exponential backoff plus jitter between tries. The last
    ``ProviderError`` is re-raised once attempts are exhausted. Only
    ``ProviderError`` is retried — any other exception propagates immediately.

    Note: "respect Retry-After on 429" is not done here. Each provider already
    converts its raw error into a status-less ``ProviderError``, so the HTTP
    status is not reliably available at this layer; honouring Retry-After is a
    documented follow-up.

    Args:
        fn: A zero-arg coroutine factory to (re)invoke per attempt.
        attempts: Maximum total attempts (must be >= 1).
        base_delay: Base backoff in seconds; doubles each retry.
        max_delay: Upper bound on any single sleep, in seconds.

    Returns:
        The value returned by ``fn`` on the first successful attempt.
    """
    last_error: ProviderError | None = None
    for attempt in range(attempts):
        try:
            return await fn()
        except ProviderError as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            backoff = min(max_delay, base_delay * (2.0**attempt))
            await asyncio.sleep(backoff + random.uniform(0, base_delay))
    assert last_error is not None  # loop runs >= 1 time, so this is set on failure
    raise last_error

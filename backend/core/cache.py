"""Optional Redis-backed response cache for LLM chat/embed calls.

:class:`ResponseCache` is a thin async Redis client keyed on a sha256 of
(provider, model, system, messages). Every operation degrades to a cache miss
when Redis is unreachable, so a dead/absent Redis never breaks a call.

The module singleton (:func:`get_response_cache`) is ``None`` when
``LOOM_REDIS_URL`` is unset — the :class:`core.providers.cached.CachedProvider`
wrapper is then never installed and behavior is byte-identical to an uncached
build. This module deliberately imports nothing from ``core.providers`` (the
wrapper lives there instead) to avoid an import cycle through the registry.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

# Chat completions drift with model updates; embeddings are stable per model.
_CHAT_TTL_S = 7 * 24 * 60 * 60
_EMBED_TTL_S = 30 * 24 * 60 * 60


def _cache_key(kind: str, provider: str, model: str, system: str, payload: Any) -> str:
    """Return ``loom:<kind>:<sha256>`` over the full request identity."""
    material = json.dumps(
        [provider, model, system, payload], sort_keys=True, ensure_ascii=False
    ).encode("utf-8")
    return f"loom:{kind}:{hashlib.sha256(material).hexdigest()}"


class ResponseCache:
    """Async Redis cache for provider responses; failures degrade to misses."""

    def __init__(self, redis_url: str) -> None:
        self._url = redis_url
        self._client: Any = None
        self._connected = False
        self._warned = False

    @property
    def connected(self) -> bool:
        """Whether the most recent Redis operation succeeded."""
        return self._connected

    def _get_client(self) -> Any:
        if self._client is None:
            import redis.asyncio as aioredis

            self._client = aioredis.from_url(
                self._url,
                socket_connect_timeout=0.5,
                socket_timeout=1.0,
                decode_responses=True,
            )
        return self._client

    def _note_failure(self) -> None:
        self._connected = False
        if not self._warned:
            self._warned = True
            logger.warning(
                "Redis cache at %s unavailable — treating cache ops as misses",
                self._url,
                exc_info=True,
            )
        else:
            logger.debug("Redis cache op failed", exc_info=True)

    async def _get(self, key: str) -> str | None:
        try:
            value: str | None = await self._get_client().get(key)
        except Exception:
            self._note_failure()
            return None
        self._connected = True
        return value

    async def _set(self, key: str, value: str, ttl_s: int) -> None:
        try:
            await self._get_client().set(key, value, ex=ttl_s)
        except Exception:
            self._note_failure()
            return
        self._connected = True

    async def get_chat(
        self, provider: str, model: str, system: str, messages: list[dict[str, Any]]
    ) -> str | None:
        """Return a cached chat completion, or None on miss/failure."""
        return await self._get(_cache_key("chat", provider, model, system, messages))

    async def set_chat(
        self,
        provider: str,
        model: str,
        system: str,
        messages: list[dict[str, Any]],
        response: str,
    ) -> None:
        """Store a chat completion (best-effort)."""
        key = _cache_key("chat", provider, model, system, messages)
        await self._set(key, response, _CHAT_TTL_S)

    async def get_embed(self, provider: str, model: str, text: str) -> list[float] | None:
        """Return a cached embedding vector, or None on miss/failure."""
        raw = await self._get(_cache_key("embed", provider, model, "", text))
        if raw is None:
            return None
        try:
            vector = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if isinstance(vector, list):
            return [float(v) for v in vector]
        return None

    async def set_embed(self, provider: str, model: str, text: str, vector: list[float]) -> None:
        """Store an embedding vector (best-effort)."""
        key = _cache_key("embed", provider, model, "", text)
        await self._set(key, json.dumps(vector), _EMBED_TTL_S)

    async def aclose(self) -> None:
        """Close the Redis client (best-effort, for app shutdown)."""
        if self._client is None:
            return
        try:
            await self._client.aclose()
        except Exception:
            logger.debug("Redis client close failed", exc_info=True)
        self._client = None


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_cache: ResponseCache | None = None
_cache_initialized = False


def get_response_cache() -> ResponseCache | None:
    """Return the process-wide ResponseCache, or None when Redis is unconfigured."""
    global _cache, _cache_initialized
    if not _cache_initialized:
        _cache_initialized = True
        _cache = ResponseCache(settings.redis_url) if settings.redis_url else None
    return _cache


def reset_response_cache() -> None:
    """Drop the singleton so the next access re-reads settings (test hook)."""
    global _cache, _cache_initialized
    _cache = None
    _cache_initialized = False

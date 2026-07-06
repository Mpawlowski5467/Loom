"""CachedProvider — serve chat/embed responses from the optional Redis cache.

Lives next to the other provider wrappers (not in :mod:`core.cache`) so the
cache module never imports the providers package — importing it the other way
round would cycle through ``core.providers.__init__`` → ``registry``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from core.cache import get_response_cache
from core.providers.base import BaseProvider


class CachedProvider(BaseProvider):
    """Wraps a BaseProvider to serve chat/embed responses from the cache.

    Installed between the concrete provider and ``TracedProvider`` (only when
    a cache is configured), so cache hits still show up in traces. Streaming
    bypasses the cache: replaying a stored string as one chunk would change
    observable behavior. Unknown attributes forward to the wrapped provider —
    notably ``name``, which ``TracedProvider._should_retry`` reads through us.
    """

    def __init__(self, inner: BaseProvider, provider_name: str = "") -> None:
        self._inner = inner
        self._provider_name = provider_name or getattr(inner, "name", inner.__class__.__name__)

    def _chat_model(self) -> str:
        return str(
            getattr(self._inner, "_chat_model", None)
            or getattr(self._inner, "chat_model", None)
            or ""
        )

    def _embed_model(self) -> str:
        return str(
            getattr(self._inner, "_embed_model", None)
            or getattr(self._inner, "embed_model", None)
            or ""
        )

    # BaseProvider API -------------------------------------------------------

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        cache = get_response_cache()
        if cache is None:
            return await self._inner.chat(messages=messages, system=system)
        model = self._chat_model()
        cached = await cache.get_chat(self._provider_name, model, system, messages)
        if cached is not None:
            return cached
        response = await self._inner.chat(messages=messages, system=system)
        await cache.set_chat(self._provider_name, model, system, messages, response)
        return response

    def chat_stream(
        self,
        messages: list[dict[str, Any]],
        system: str = "",
    ) -> AsyncIterator[str]:
        return self._inner.chat_stream(messages=messages, system=system)

    async def embed(self, text: str) -> list[float]:
        cache = get_response_cache()
        if cache is None:
            return await self._inner.embed(text)
        model = self._embed_model()
        cached = await cache.get_embed(self._provider_name, model, text)
        if cached is not None:
            return cached
        vector = await self._inner.embed(text)
        await cache.set_embed(self._provider_name, model, text, vector)
        return vector

    # Pass-through -----------------------------------------------------------

    def __getattr__(self, name: str) -> Any:
        # Called only when the attribute is not found on CachedProvider.
        # Avoid recursion on _inner before __init__ has set it.
        if name == "_inner":
            raise AttributeError(name)
        return getattr(self._inner, name)

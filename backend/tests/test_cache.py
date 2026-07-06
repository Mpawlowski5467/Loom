"""Tests for the optional Redis response cache and the CachedProvider wrapper."""

from __future__ import annotations

import logging
from typing import Any

import pytest

import core.cache as cache_mod
from core.cache import (
    _CHAT_TTL_S,
    _EMBED_TTL_S,
    ResponseCache,
    _cache_key,
    get_response_cache,
    reset_response_cache,
)
from core.config import GlobalConfig, ProviderConfig, settings
from core.providers import (
    OllamaProvider,
    ProviderRegistry,
    TracedProvider,
    unwrap_provider,
)
from core.providers.base import BaseProvider
from core.providers.cached import CachedProvider

# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class StubRedis:
    """Records set() calls and serves get() from an in-memory dict."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.set_calls: list[tuple[str, str, int | None]] = []

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value
        self.set_calls.append((key, value, ex))

    async def aclose(self) -> None:
        pass


class BrokenRedis:
    """Every operation raises, simulating a dead Redis."""

    async def get(self, key: str) -> str | None:
        raise ConnectionError("redis down")

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        raise ConnectionError("redis down")


class FakeProvider(BaseProvider):
    name = "fake"

    def __init__(self) -> None:
        self._chat_model = "fake-chat"
        self._embed_model = "fake-embed"
        self.chat_calls = 0
        self.embed_calls = 0
        self.stream_calls = 0

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:
        self.chat_calls += 1
        return f"reply-{self.chat_calls}"

    async def embed(self, text: str) -> list[float]:
        self.embed_calls += 1
        return [0.1, 0.2]

    async def chat_stream(self, messages: list[dict[str, Any]], system: str = ""):
        self.stream_calls += 1
        yield "chunk-a"
        yield "chunk-b"


def _stub_backed_cache() -> tuple[ResponseCache, StubRedis]:
    cache = ResponseCache("redis://stub")
    stub = StubRedis()
    cache._client = stub
    return cache, stub


@pytest.fixture()
def installed_cache(monkeypatch: pytest.MonkeyPatch) -> tuple[ResponseCache, StubRedis]:
    """Install a stub-backed ResponseCache as the module singleton."""
    cache, stub = _stub_backed_cache()
    monkeypatch.setattr(cache_mod, "_cache", cache)
    monkeypatch.setattr(cache_mod, "_cache_initialized", True)
    return cache, stub


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------


class TestCacheKey:
    def test_key_is_deterministic(self) -> None:
        messages = [{"role": "user", "content": "hi"}]
        a = _cache_key("chat", "openai", "gpt-4o", "sys", messages)
        b = _cache_key("chat", "openai", "gpt-4o", "sys", messages)
        assert a == b
        assert a.startswith("loom:chat:")

    def test_key_varies_with_every_component(self) -> None:
        base = _cache_key("chat", "openai", "gpt-4o", "sys", [{"content": "hi"}])
        assert _cache_key("chat", "ollama", "gpt-4o", "sys", [{"content": "hi"}]) != base
        assert _cache_key("chat", "openai", "gpt-4", "sys", [{"content": "hi"}]) != base
        assert _cache_key("chat", "openai", "gpt-4o", "other", [{"content": "hi"}]) != base
        assert _cache_key("chat", "openai", "gpt-4o", "sys", [{"content": "yo"}]) != base
        assert _cache_key("embed", "openai", "gpt-4o", "sys", [{"content": "hi"}]) != base


# ---------------------------------------------------------------------------
# ResponseCache
# ---------------------------------------------------------------------------


class TestResponseCache:
    @pytest.mark.asyncio
    async def test_chat_miss_then_hit_with_ttl(self) -> None:
        cache, stub = _stub_backed_cache()
        messages = [{"role": "user", "content": "hi"}]

        assert await cache.get_chat("openai", "gpt-4o", "sys", messages) is None
        await cache.set_chat("openai", "gpt-4o", "sys", messages, "the reply")

        assert await cache.get_chat("openai", "gpt-4o", "sys", messages) == "the reply"
        key, value, ttl = stub.set_calls[-1]
        assert key.startswith("loom:chat:")
        assert value == "the reply"
        assert ttl == _CHAT_TTL_S

    @pytest.mark.asyncio
    async def test_embed_roundtrip_with_ttl(self) -> None:
        cache, stub = _stub_backed_cache()

        assert await cache.get_embed("openai", "small", "hello") is None
        await cache.set_embed("openai", "small", "hello", [0.25, -1.5])

        assert await cache.get_embed("openai", "small", "hello") == [0.25, -1.5]
        key, _value, ttl = stub.set_calls[-1]
        assert key.startswith("loom:embed:")
        assert ttl == _EMBED_TTL_S

    @pytest.mark.asyncio
    async def test_redis_errors_degrade_to_miss(self) -> None:
        cache = ResponseCache("redis://broken")
        cache._client = BrokenRedis()

        assert await cache.get_chat("p", "m", "", []) is None
        await cache.set_chat("p", "m", "", [], "x")  # must not raise
        assert await cache.get_embed("p", "m", "t") is None
        assert cache.connected is False

    @pytest.mark.asyncio
    async def test_failure_warns_once_then_quiet(self, caplog: pytest.LogCaptureFixture) -> None:
        cache = ResponseCache("redis://broken")
        cache._client = BrokenRedis()

        with caplog.at_level(logging.WARNING, logger="core.cache"):
            await cache.get_chat("p", "m", "", [])
            await cache.get_chat("p", "m", "", [])
            await cache.set_chat("p", "m", "", [], "x")

        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1

    @pytest.mark.asyncio
    async def test_connected_reflects_last_op(self) -> None:
        cache, _stub = _stub_backed_cache()
        assert cache.connected is False
        await cache.get_chat("p", "m", "", [])
        assert cache.connected is True


class TestSingleton:
    def test_none_when_unconfigured(self) -> None:
        reset_response_cache()
        assert get_response_cache() is None

    def test_created_when_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:6379/0")
        reset_response_cache()
        cache = get_response_cache()
        assert isinstance(cache, ResponseCache)
        assert get_response_cache() is cache  # cached singleton


# ---------------------------------------------------------------------------
# CachedProvider
# ---------------------------------------------------------------------------


class TestCachedProvider:
    @pytest.mark.asyncio
    async def test_chat_caches_and_skips_inner_on_hit(
        self, installed_cache: tuple[ResponseCache, StubRedis]
    ) -> None:
        inner = FakeProvider()
        provider = CachedProvider(inner, provider_name="fake")
        messages = [{"role": "user", "content": "hi"}]

        first = await provider.chat(messages, system="sys")
        second = await provider.chat(messages, system="sys")

        assert first == second == "reply-1"
        assert inner.chat_calls == 1

    @pytest.mark.asyncio
    async def test_embed_caches_and_skips_inner_on_hit(
        self, installed_cache: tuple[ResponseCache, StubRedis]
    ) -> None:
        inner = FakeProvider()
        provider = CachedProvider(inner, provider_name="fake")

        assert await provider.embed("hello") == [0.1, 0.2]
        assert await provider.embed("hello") == [0.1, 0.2]
        assert inner.embed_calls == 1

    @pytest.mark.asyncio
    async def test_chat_stream_bypasses_cache(
        self, installed_cache: tuple[ResponseCache, StubRedis]
    ) -> None:
        _cache, stub = installed_cache
        inner = FakeProvider()
        provider = CachedProvider(inner, provider_name="fake")

        for _ in range(2):
            chunks = [c async for c in provider.chat_stream([{"content": "hi"}])]
            assert chunks == ["chunk-a", "chunk-b"]

        assert inner.stream_calls == 2  # never served from cache
        assert stub.set_calls == []  # and never stored

    @pytest.mark.asyncio
    async def test_no_cache_configured_passes_straight_through(self) -> None:
        reset_response_cache()
        inner = FakeProvider()
        provider = CachedProvider(inner, provider_name="fake")

        assert await provider.chat([{"content": "hi"}]) == "reply-1"
        assert await provider.chat([{"content": "hi"}]) == "reply-2"
        assert inner.chat_calls == 2

    def test_forwards_attributes_to_inner(self) -> None:
        inner = FakeProvider()
        provider = CachedProvider(inner)
        assert provider.name == "fake"
        assert provider._chat_model() == "fake-chat"
        # TracedProvider._should_retry reads .name through the cache layer.
        traced = TracedProvider(provider, provider_name="fake")
        assert traced._should_retry() is True


# ---------------------------------------------------------------------------
# Registry integration
# ---------------------------------------------------------------------------


def _ollama_config() -> GlobalConfig:
    return GlobalConfig(providers={"ollama": ProviderConfig(host="http://localhost:11434")})


class TestRegistryWrapping:
    def test_unwrap_peels_both_layers(self) -> None:
        concrete = FakeProvider()
        double_wrapped = TracedProvider(CachedProvider(concrete, "fake"), provider_name="fake")
        assert unwrap_provider(double_wrapped) is concrete
        single_wrapped = TracedProvider(concrete, provider_name="fake")
        assert unwrap_provider(single_wrapped) is concrete
        assert unwrap_provider(concrete) is concrete

    def test_registry_skips_cache_layer_when_unconfigured(self) -> None:
        reset_response_cache()
        provider = ProviderRegistry(_ollama_config()).get("ollama")
        assert isinstance(provider, TracedProvider)
        assert isinstance(provider._inner, OllamaProvider)

    def test_registry_adds_cache_layer_when_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:6379/0")
        reset_response_cache()
        provider = ProviderRegistry(_ollama_config()).get("ollama")
        assert isinstance(provider, TracedProvider)
        assert isinstance(provider._inner, CachedProvider)
        assert isinstance(provider._inner._inner, OllamaProvider)
        assert unwrap_provider(provider) is provider._inner._inner

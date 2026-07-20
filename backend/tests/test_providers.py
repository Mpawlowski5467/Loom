"""Tests for the provider system in core/providers.py."""

from unittest.mock import patch

import pytest

from core.config import GlobalConfig, ProviderConfig
from core.exceptions import ProviderConfigError
from core.providers import (
    AnthropicProvider,
    CodexProvider,
    OllamaProvider,
    OpenAIProvider,
    ProviderRegistry,
    XAIProvider,
    unwrap_provider,
)


def _make_config(
    providers: dict[str, dict] | None = None,
    default_provider: str = "openai",
    embed_provider: str | None = None,
    chat_provider: str | None = None,
) -> GlobalConfig:
    """Build a GlobalConfig with provider entries for testing."""
    raw = providers or {}
    provider_configs = {name: ProviderConfig(**vals) for name, vals in raw.items()}
    return GlobalConfig(
        providers=provider_configs,
        embed_provider=embed_provider,
        chat_provider=chat_provider,
    )


# ---------------------------------------------------------------------------
# ProviderRegistry initialization
# ---------------------------------------------------------------------------


class TestRegistryInit:
    def test_creates_from_global_config(self) -> None:
        """ProviderRegistry can be created from a GlobalConfig."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)
        assert registry is not None

    def test_empty_providers(self) -> None:
        """Registry works with empty provider dict."""
        cfg = _make_config(providers={})
        registry = ProviderRegistry(cfg)
        assert registry is not None


# ---------------------------------------------------------------------------
# get() — valid provider
# ---------------------------------------------------------------------------


class TestRegistryGetValid:
    @patch("core.providers.codex._codex_binary", return_value="/usr/bin/codex")
    def test_get_codex_provider(self, _binary) -> None:
        """get('codex') returns the opt-in local app-server bridge."""
        cfg = _make_config(providers={"codex": {"chat_model": "default"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("codex")

        assert isinstance(unwrap_provider(provider), CodexProvider)
        assert provider.name == "codex"

    def test_get_ollama_provider(self) -> None:
        """get('ollama') returns an OllamaProvider instance."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")

        assert isinstance(unwrap_provider(provider), OllamaProvider)
        assert provider.name == "ollama"

    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-key"})
    def test_get_openai_provider(self) -> None:
        """get('openai') returns an OpenAIProvider when API key is set."""
        cfg = _make_config(providers={"openai": {"api_key": "sk-test-key", "chat_model": "gpt-4o"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("openai")

        assert isinstance(unwrap_provider(provider), OpenAIProvider)
        assert provider.name == "openai"

    @patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-test"})
    def test_get_anthropic_provider(self) -> None:
        """get('anthropic') returns an AnthropicProvider when API key is set."""
        cfg = _make_config(providers={"anthropic": {"api_key": "sk-ant-test"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("anthropic")

        assert isinstance(unwrap_provider(provider), AnthropicProvider)
        assert provider.name == "anthropic"

    @patch.dict("os.environ", {"XAI_API_KEY": "xai-test-key"})
    def test_get_xai_provider(self) -> None:
        """get('xai') returns an XAIProvider when API key is set."""
        cfg = _make_config(providers={"xai": {"api_key": "xai-test-key"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("xai")

        assert isinstance(unwrap_provider(provider), XAIProvider)
        assert provider.name == "xai"


# ---------------------------------------------------------------------------
# get() — invalid / missing provider
# ---------------------------------------------------------------------------


class TestRegistryGetInvalid:
    def test_get_unconfigured_provider_raises(self) -> None:
        """get() with a name not in config raises ProviderConfigError."""
        cfg = _make_config(providers={})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="not configured"):
            registry.get("openai")

    def test_get_unknown_provider_type_raises(self) -> None:
        """get() with an unsupported provider name raises ProviderConfigError."""
        cfg = _make_config(providers={"foobar": {"api_key": "test"}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="Unknown provider"):
            registry.get("foobar")


# ---------------------------------------------------------------------------
# Provider caching
# ---------------------------------------------------------------------------


class TestRegistryCaching:
    def test_get_returns_same_instance(self) -> None:
        """Subsequent get() calls return the cached provider instance."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        p1 = registry.get("ollama")
        p2 = registry.get("ollama")

        assert p1 is p2


# ---------------------------------------------------------------------------
# Default / embed / chat provider resolution
# ---------------------------------------------------------------------------


class TestProviderResolution:
    def test_get_embed_provider_falls_back_to_default(self) -> None:
        """get_embed_provider() uses the default provider when no explicit embed_provider."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        # Patch _default_name to return 'ollama'
        with patch.object(registry, "_default_name", return_value="ollama"):
            provider = registry.get_embed_provider()

        assert isinstance(unwrap_provider(provider), OllamaProvider)

    def test_get_chat_provider_falls_back_to_default(self) -> None:
        """get_chat_provider() uses the default provider when no explicit chat_provider."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        with patch.object(registry, "_default_name", return_value="ollama"):
            provider = registry.get_chat_provider()

        assert isinstance(unwrap_provider(provider), OllamaProvider)

    def test_explicit_embed_provider(self) -> None:
        """get_embed_provider() uses the explicit embed_provider when set."""
        cfg = _make_config(
            providers={"ollama": {"host": "http://localhost:11434"}},
            embed_provider="ollama",
        )
        registry = ProviderRegistry(cfg)

        provider = registry.get_embed_provider()

        assert isinstance(unwrap_provider(provider), OllamaProvider)

    def test_explicit_chat_provider(self) -> None:
        """get_chat_provider() uses the explicit chat_provider when set."""
        cfg = _make_config(
            providers={"ollama": {"host": "http://localhost:11434"}},
            chat_provider="ollama",
        )
        registry = ProviderRegistry(cfg)

        provider = registry.get_chat_provider()

        assert isinstance(unwrap_provider(provider), OllamaProvider)


# ---------------------------------------------------------------------------
# API key validation
# ---------------------------------------------------------------------------


class TestProviderApiKeyValidation:
    @patch.dict("os.environ", {}, clear=True)
    def test_openai_missing_api_key_raises(self) -> None:
        """OpenAI provider without API key (env or config) raises ProviderConfigError."""
        cfg = _make_config(providers={"openai": {}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="API key not set"):
            registry.get("openai")

    @patch.dict("os.environ", {}, clear=True)
    def test_anthropic_missing_api_key_raises(self) -> None:
        """Anthropic provider without API key raises ProviderConfigError."""
        cfg = _make_config(providers={"anthropic": {}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="API key not set"):
            registry.get("anthropic")

    @patch.dict("os.environ", {}, clear=True)
    def test_xai_missing_api_key_raises(self) -> None:
        """xAI provider without API key raises ProviderConfigError."""
        cfg = _make_config(providers={"xai": {}})
        registry = ProviderRegistry(cfg)

        with pytest.raises(ProviderConfigError, match="API key not set"):
            registry.get("xai")

    def test_ollama_does_not_require_api_key(self) -> None:
        """Ollama provider doesn't need an API key — just a host."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")

        assert isinstance(unwrap_provider(provider), OllamaProvider)


# ---------------------------------------------------------------------------
# OllamaProvider httpx client reuse
# ---------------------------------------------------------------------------


class TestOllamaClientReuse:
    def test_ollama_reuses_httpx_client(self) -> None:
        """OllamaProvider stores a single httpx.AsyncClient internally."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")
        assert isinstance(unwrap_provider(provider), OllamaProvider)

        # The internal client should be the same object on repeated access
        client1 = provider._client
        client2 = provider._client
        assert client1 is client2


# ---------------------------------------------------------------------------
# Registry close
# ---------------------------------------------------------------------------


class TestTracedProviderWrapper:
    @pytest.mark.asyncio
    async def test_chat_records_trace(self) -> None:
        """A chat call through the wrapped provider gets recorded into the trace store."""
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider
        from core.traces import get_trace_store

        class FakeProvider(BaseProvider):
            name = "fake"
            chat_model = "fake-model"

            async def embed(self, text: str) -> list[float]:
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                return "fake response"

        wrapped = TracedProvider(FakeProvider(), provider_name="fake")

        store = get_trace_store()
        before = len(store.list(limit=10))

        result = await wrapped.chat(messages=[{"role": "user", "content": "hi"}])

        assert result == "fake response"
        after = store.list(limit=10)
        assert len(after) == before + 1
        latest = after[0]
        assert latest.provider == "fake"
        assert latest.model == "fake-model"
        assert latest.response == "fake response"
        assert latest.error == ""

    @pytest.mark.asyncio
    async def test_chat_error_still_recorded(self) -> None:
        """When the inner provider raises, the wrapper still records the trace with error."""
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider
        from core.traces import get_trace_store

        class ExplodingProvider(BaseProvider):
            name = "boom"
            chat_model = "boom-model"

            async def embed(self, text: str) -> list[float]:
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                raise RuntimeError("kaboom")

        wrapped = TracedProvider(ExplodingProvider(), provider_name="boom")
        store = get_trace_store()
        before = len(store.list(limit=10))

        with pytest.raises(RuntimeError, match="kaboom"):
            await wrapped.chat(messages=[{"role": "user", "content": "hi"}])

        after = store.list(limit=10)
        assert len(after) == before + 1
        assert after[0].error == "kaboom"

    @pytest.mark.asyncio
    async def test_embed_passes_through_untraced(self) -> None:
        """embed() goes straight to the inner provider; no trace is recorded."""
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider
        from core.traces import get_trace_store

        class FakeProvider(BaseProvider):
            name = "fake"
            chat_model = "fake-model"
            embed_call_count = 0

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                self.embed_call_count += 1
                return [1.0, 2.0, 3.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                return ""

        inner = FakeProvider()
        wrapped = TracedProvider(inner, provider_name="fake")

        store = get_trace_store()
        before = len(store.list(limit=10))

        vec = await wrapped.embed("hello")

        assert vec == [1.0, 2.0, 3.0]
        assert inner.embed_call_count == 1
        # Embed must NOT have added a trace record.
        assert len(store.list(limit=10)) == before

    def test_forwards_unknown_attributes_to_inner(self) -> None:
        """Attribute access falls through to the inner provider."""
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class FakeProvider(BaseProvider):
            name = "fancy"
            custom_attr = "custom_value"

            async def embed(self, text: str) -> list[float]:
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                return ""

        wrapped = TracedProvider(FakeProvider(), provider_name="fancy")
        assert wrapped.custom_attr == "custom_value"
        assert wrapped.name == "fancy"


class TestTracedProviderRetry:
    """TracedProvider retries transient ProviderError, except for OpenRouter."""

    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Make backoff sleeps instant so the suite stays sub-second."""
        import core.providers._retry as retry_mod

        async def _instant(_seconds: float) -> None:
            return None

        monkeypatch.setattr(retry_mod.asyncio, "sleep", _instant)

    @pytest.mark.asyncio
    async def test_chat_retries_then_succeeds(self) -> None:
        """chat() retries a transient ProviderError up to 3 attempts total."""
        from core.exceptions import ProviderError
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class FlakyProvider(BaseProvider):
            name = "flaky"
            chat_model = "flaky-model"

            def __init__(self) -> None:
                self.attempts = 0

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                self.attempts += 1
                if self.attempts < 3:
                    raise ProviderError("flaky", "transient blip")
                return "recovered"

        inner = FlakyProvider()
        wrapped = TracedProvider(inner, provider_name="flaky")

        result = await wrapped.chat(messages=[{"role": "user", "content": "hi"}])

        assert result == "recovered"
        assert inner.attempts == 3  # two failures + one success

    @pytest.mark.asyncio
    async def test_chat_reraises_after_exhausting_attempts(self) -> None:
        """When every attempt fails, the last ProviderError propagates."""
        from core.exceptions import ProviderError
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class AlwaysFails(BaseProvider):
            name = "doomed"
            chat_model = "doomed-model"

            def __init__(self) -> None:
                self.attempts = 0

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                self.attempts += 1
                raise ProviderError("doomed", "always down")

        inner = AlwaysFails()
        wrapped = TracedProvider(inner, provider_name="doomed")

        with pytest.raises(ProviderError, match="always down"):
            await wrapped.chat(messages=[{"role": "user", "content": "hi"}])

        assert inner.attempts == 3  # exactly the bounded attempt count

    @pytest.mark.asyncio
    async def test_openrouter_is_attempted_exactly_once(self) -> None:
        """OpenRouter runs its own 429 loop — the generic retry must not wrap it."""
        from core.exceptions import ProviderError
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class FakeOpenRouter(BaseProvider):
            name = "openrouter"
            chat_model = "or-model"

            def __init__(self) -> None:
                self.attempts = 0

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                self.attempts += 1
                raise ProviderError("openrouter", "rate limited")

        inner = FakeOpenRouter()
        wrapped = TracedProvider(inner, provider_name="openrouter")

        with pytest.raises(ProviderError, match="rate limited"):
            await wrapped.chat(messages=[{"role": "user", "content": "hi"}])

        assert inner.attempts == 1  # NOT retried

    @pytest.mark.asyncio
    async def test_embed_retries_then_succeeds(self) -> None:
        """embed() shares the same bounded retry as chat()."""
        from core.exceptions import ProviderError
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class FlakyEmbed(BaseProvider):
            name = "flakyembed"

            def __init__(self) -> None:
                self.attempts = 0

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                self.attempts += 1
                if self.attempts < 2:
                    raise ProviderError("flakyembed", "cold start")
                return [1.0, 2.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                return ""

        inner = FlakyEmbed()
        wrapped = TracedProvider(inner, provider_name="flakyembed")

        vec = await wrapped.embed("hello")

        assert vec == [1.0, 2.0]
        assert inner.attempts == 2

    @pytest.mark.asyncio
    async def test_non_provider_error_not_retried(self) -> None:
        """Only ProviderError is retried; other exceptions propagate immediately."""
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class Boom(BaseProvider):
            name = "boom"
            chat_model = "boom-model"

            def __init__(self) -> None:
                self.attempts = 0

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                self.attempts += 1
                raise RuntimeError("not transient")

        inner = Boom()
        wrapped = TracedProvider(inner, provider_name="boom")

        with pytest.raises(RuntimeError, match="not transient"):
            await wrapped.chat(messages=[{"role": "user", "content": "hi"}])

        assert inner.attempts == 1

    @pytest.mark.asyncio
    async def test_chat_stream_retries_connection_then_streams(self) -> None:
        """chat_stream retries the connection phase but never replays mid-stream."""
        from core.exceptions import ProviderError
        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class FlakyStream(BaseProvider):
            name = "flakystream"
            chat_model = "fs-model"

            def __init__(self) -> None:
                self.opens = 0

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                return ""

            async def chat_stream(self, messages, system=""):  # noqa: ARG002
                self.opens += 1
                if self.opens == 1:
                    raise ProviderError("flakystream", "connection reset")
                for tok in ("hello", " ", "world"):
                    yield tok

        inner = FlakyStream()
        wrapped = TracedProvider(inner, provider_name="flakystream")

        collected = [chunk async for chunk in wrapped.chat_stream(messages=[])]

        assert "".join(collected) == "hello world"
        assert inner.opens == 2  # first open failed, second succeeded


class TestRegistryClose:
    @pytest.mark.asyncio
    async def test_close_calls_provider_close(self) -> None:
        """close() calls close() on providers that have it (e.g. Ollama)."""
        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        registry = ProviderRegistry(cfg)

        provider = registry.get("ollama")
        assert isinstance(unwrap_provider(provider), OllamaProvider)

        # Patch the close method
        close_called = False

        async def mock_close():
            nonlocal close_called
            close_called = True

        provider.close = mock_close
        await registry.close()

        assert close_called


class TestTracedProviderRetire:
    """retire_when_idle: a registry reset must not close a provider whose
    calls are still in flight or recently active (issue #28)."""

    @pytest.mark.asyncio
    async def test_close_waits_for_inflight_call(self) -> None:
        import asyncio

        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        release = asyncio.Event()

        class SlowProvider(BaseProvider):
            name = "slow"
            closed = False

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                await release.wait()
                return "done"

            async def close(self) -> None:
                self.closed = True

        inner = SlowProvider()
        wrapped = TracedProvider(inner, provider_name="slow")

        chat_task = asyncio.create_task(wrapped.chat([{"role": "user", "content": "hi"}]))
        await asyncio.sleep(0)  # let chat enter the in-flight window
        reaper = asyncio.create_task(wrapped.retire_when_idle(0.05, poll_s=0.01))
        await asyncio.sleep(0.1)

        assert not inner.closed, "closed while a call was in flight"

        release.set()
        assert await chat_task == "done"
        await asyncio.wait_for(reaper, timeout=2)
        assert inner.closed

    @pytest.mark.asyncio
    async def test_close_waits_out_quiescence(self) -> None:
        """No in-flight call, but a call ended moments ago — the reaper must
        wait out the quiescence window (covers inter-step gaps in a run)."""
        import asyncio

        from core.providers import TracedProvider
        from core.providers.base import BaseProvider

        class QuickProvider(BaseProvider):
            name = "quick"
            closed = False

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                return "ok"

            async def close(self) -> None:
                self.closed = True

        inner = QuickProvider()
        wrapped = TracedProvider(inner, provider_name="quick")
        await wrapped.chat([{"role": "user", "content": "hi"}])

        reaper = asyncio.create_task(wrapped.retire_when_idle(0.2, poll_s=0.02))
        await asyncio.sleep(0.1)
        assert not inner.closed, "closed inside the quiescence window"

        await asyncio.wait_for(reaper, timeout=2)
        assert inner.closed

    @pytest.mark.asyncio
    async def test_reset_registry_retires_without_immediate_close(self) -> None:
        """reset_registry swaps the singleton but retires old providers — the
        old client's close() is deferred to the reaper, not fired inline."""

        import core.providers.registry as registry_module
        from core.providers.base import BaseProvider
        from core.providers.registry import ProviderRegistry

        class ClosingTracker(BaseProvider):
            name = "ollama"  # must be a known provider for registry.get
            closed = False

            async def embed(self, text: str) -> list[float]:  # noqa: ARG002
                return [0.0]

            async def chat(self, messages, system=""):  # noqa: ARG002
                return "ok"

            async def close(self) -> None:
                self.closed = True

        cfg = _make_config(providers={"ollama": {"host": "http://localhost:11434"}})
        old_registry = ProviderRegistry(cfg)
        provider = old_registry.get("ollama")
        # Swap in our spy at the layer the reaper will close.
        tracker = ClosingTracker()
        provider._inner = tracker

        previous = registry_module._registry
        registry_module._registry = old_registry
        try:
            await registry_module.reset_registry()
            assert registry_module._registry is None
            assert not tracker.closed, "reset_registry closed a provider inline"

            # The reaper closes it after drain + quiescence (60s in prod —
            # patch the module constant down so the test doesn't wait).
            import core.providers.registry as reg

            for task in list(reg._reaper_tasks):
                task.cancel()
        finally:
            registry_module._registry = previous


class TestOllamaChatStreaming:
    """chat() consumes the streaming endpoint so a slow local model keeps the
    httpx read window as a between-chunks stall detector instead of a
    whole-generation budget (issue #25)."""

    @staticmethod
    def _provider_with_transport(handler) -> OllamaProvider:
        import httpx as _httpx

        from core.providers.base import OllamaProviderConfig

        provider = OllamaProvider(OllamaProviderConfig(host="http://localhost:11434"))
        provider._client = _httpx.AsyncClient(
            base_url="http://localhost:11434",
            transport=_httpx.MockTransport(handler),
        )
        return provider

    @pytest.mark.asyncio
    async def test_chat_assembles_streamed_chunks(self) -> None:
        import httpx as _httpx

        def handler(request: _httpx.Request) -> _httpx.Response:
            assert request.url.path == "/api/chat"
            assert b'"stream": true' in request.read() or b'"stream":true' in request.read()
            lines = (
                '{"message": {"content": "Hello"}, "done": false}\n'
                '{"message": {"content": ", world"}, "done": false}\n'
                '{"message": {"content": "!"}, "done": true}\n'
            )
            return _httpx.Response(200, text=lines)

        provider = self._provider_with_transport(handler)
        result = await provider.chat([{"role": "user", "content": "hi"}])
        assert result == "Hello, world!"

    @pytest.mark.asyncio
    async def test_chat_skips_reasoning_chunks(self) -> None:
        """Reasoning models stream chain-of-thought in `thinking` — it must
        not pollute the assembled answer."""
        import httpx as _httpx

        def handler(request: _httpx.Request) -> _httpx.Response:
            lines = (
                '{"message": {"thinking": "let me ponder this at great length"}, "done": false}\n'
                '{"message": {"content": "The answer is 4."}, "done": false}\n'
                '{"message": {"content": ""}, "done": true}\n'
            )
            return _httpx.Response(200, text=lines)

        provider = self._provider_with_transport(handler)
        result = await provider.chat([{"role": "user", "content": "2+2?"}])
        assert result == "The answer is 4."

    @pytest.mark.asyncio
    async def test_chat_http_error_raises_provider_error(self) -> None:
        import httpx as _httpx

        from core.exceptions import ProviderError

        def handler(request: _httpx.Request) -> _httpx.Response:
            return _httpx.Response(500, text="boom")

        provider = self._provider_with_transport(handler)
        with pytest.raises(ProviderError):
            await provider.chat([{"role": "user", "content": "hi"}])

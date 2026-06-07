"""Provider registry: loads configs and builds provider instances."""

from __future__ import annotations

import contextlib
import logging
import time
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import Depends

from core.activity import get_activity
from core.config import GlobalConfig, settings
from core.exceptions import ProviderConfigError
from core.providers._retry import with_retry
from core.providers.anthropic import AnthropicProvider
from core.providers.base import (
    AnthropicProviderConfig,
    BaseProvider,
    OllamaProviderConfig,
    OpenAICompatProviderConfig,
    OpenAIProviderConfig,
    OpenRouterProviderConfig,
    XAIProviderConfig,
)
from core.providers.ollama import OllamaProvider
from core.providers.openai import OpenAIProvider
from core.providers.openai_compatible import (
    DeepSeekProvider,
    GeminiProvider,
    GroqProvider,
    MistralProvider,
    TogetherProvider,
)
from core.providers.openrouter import OpenRouterProvider
from core.providers.xai import XAIProvider
from core.traces import TraceRecord, get_caller, get_trace_store

logger = logging.getLogger(__name__)

_COUNCIL_AGENTS = ("weaver", "spider", "archivist", "scribe", "sentinel")


def _agents_for_caller(caller: str) -> tuple[str, ...]:
    """Map a trace caller label to the agent(s) that should pulse during the call."""
    if not caller:
        return ()
    if caller == "council":
        return _COUNCIL_AGENTS
    # Caller may be 'weaver:capture', 'researcher', etc. Take the prefix.
    return (caller.split(":", 1)[0],)


if TYPE_CHECKING:
    from pydantic import BaseModel

_CONFIG_MODEL_MAP: dict[str, type[BaseModel]] = {
    "openai": OpenAIProviderConfig,
    "anthropic": AnthropicProviderConfig,
    "ollama": OllamaProviderConfig,
    "xai": XAIProviderConfig,
    "openrouter": OpenRouterProviderConfig,
    "groq": OpenAICompatProviderConfig,
    "deepseek": OpenAICompatProviderConfig,
    "together": OpenAICompatProviderConfig,
    "mistral": OpenAICompatProviderConfig,
    "gemini": OpenAICompatProviderConfig,
}

_PROVIDER_CLASS_MAP: dict[str, type[BaseProvider]] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "ollama": OllamaProvider,
    "xai": XAIProvider,
    "openrouter": OpenRouterProvider,
    "groq": GroqProvider,
    "deepseek": DeepSeekProvider,
    "together": TogetherProvider,
    "mistral": MistralProvider,
    "gemini": GeminiProvider,
}


class ProviderRegistry:
    """Loads provider configs from GlobalConfig and builds provider instances."""

    def __init__(self, global_config: GlobalConfig) -> None:
        self._global_config = global_config
        self._providers: dict[str, BaseProvider] = {}

    def _resolve_config(self, name: str) -> BaseModel:
        """Parse the raw ProviderConfig into a typed config model."""
        raw = self._global_config.providers.get(name)
        if raw is None:
            raise ProviderConfigError(f"Provider '{name}' is not configured in config.yaml.")
        config_cls = _CONFIG_MODEL_MAP.get(name)
        if config_cls is None:
            raise ProviderConfigError(
                f"Unknown provider '{name}'. Supported: {', '.join(_CONFIG_MODEL_MAP)}."
            )
        return config_cls.model_validate(raw.model_dump(exclude_none=True))

    def get(self, name: str) -> BaseProvider:
        """Return a cached provider instance by name, wrapped with tracing."""
        if name not in self._providers:
            cfg = self._resolve_config(name)
            provider_cls = _PROVIDER_CLASS_MAP[name]
            # Each provider class takes its specific *ProviderConfig in __init__;
            # BaseProvider itself takes none, so mypy can't see the call signature.
            instance = provider_cls(cfg)  # type: ignore[call-arg]
            self._providers[name] = TracedProvider(instance, provider_name=name)
        return self._providers[name]

    def get_embed_provider(self) -> BaseProvider:
        """Return the provider configured for embeddings.

        Checks for an explicit ``embed_provider`` key in the global config,
        falls back to the default provider.
        """
        return self.get(self._embed_provider_name())

    def get_chat_provider(self) -> BaseProvider:
        """Return the provider configured for chat.

        Checks for an explicit ``chat_provider`` key in the global config,
        falls back to the default provider.
        """
        return self.get(self._chat_provider_name())

    def _embed_provider_name(self) -> str:
        raw = self._global_config.model_dump()
        return raw.get("embed_provider") or self._default_name()

    def _chat_provider_name(self) -> str:
        raw = self._global_config.model_dump()
        return raw.get("chat_provider") or self._default_name()

    async def close(self) -> None:
        """Close any providers that hold resources (e.g. httpx clients)."""
        for provider in self._providers.values():
            if hasattr(provider, "close"):
                await provider.close()

    def _default_name(self) -> str:
        return settings.default_provider


# ---------------------------------------------------------------------------
# Module-level singleton + FastAPI dependencies
# ---------------------------------------------------------------------------

_registry: ProviderRegistry | None = None


def get_registry() -> ProviderRegistry:
    """Return (and lazily create) the global ProviderRegistry."""
    global _registry
    if _registry is None:
        global_config = GlobalConfig.load(settings.config_path)
        _registry = ProviderRegistry(global_config)
    return _registry


async def reset_registry() -> None:
    """Force re-creation of the registry (useful after config changes).

    Closes any provider clients first so we don't leak httpx connections.
    Best-effort: any close failure is swallowed so the registry slot
    is always cleared.
    """
    global _registry
    if _registry is not None:
        with contextlib.suppress(Exception):
            await _registry.close()
    _registry = None


def get_embed_provider() -> BaseProvider:
    """FastAPI dependency that returns the configured embedding provider."""
    return get_registry().get_embed_provider()


def get_chat_provider() -> BaseProvider:
    """FastAPI dependency that returns the configured chat provider."""
    return get_registry().get_chat_provider()


EmbedProvider = Annotated[BaseProvider, Depends(get_embed_provider)]
ChatProvider = Annotated[BaseProvider, Depends(get_chat_provider)]


def unwrap_provider(provider: BaseProvider) -> BaseProvider:
    """Return the underlying provider, peeling off any TracedProvider wrapping.

    Production code should not need this — call ``provider.chat()`` /
    ``provider.embed()`` directly and the wrapper handles tracing. Tests
    that need to assert on the concrete provider class use it to skip the
    wrapper.
    """
    inner = getattr(provider, "_inner", None)
    return inner if isinstance(inner, BaseProvider) else provider


class TracedProvider(BaseProvider):
    """Wraps a BaseProvider to record every chat() call into the trace store.

    Replaces an earlier monkey-patch on the provider's ``chat`` method. Embed
    calls pass through untraced; chat calls record duration, caller, model,
    messages, and response (or error) to the in-memory ring buffer and drive
    per-agent activity pulses.

    Any other attribute is forwarded to the wrapped provider so callers that
    rely on provider-specific attributes (e.g. ``name``, ``close``) keep
    working.
    """

    def __init__(self, inner: BaseProvider, provider_name: str = "") -> None:
        self._inner = inner
        self._provider_name = provider_name or getattr(inner, "name", inner.__class__.__name__)

    def _should_retry(self) -> bool:
        """Whether this provider's transient failures should be retried here.

        OpenRouter runs its own per-minute 429 backoff loop (see
        ``openrouter.py``); wrapping it again would multiply waits and burn the
        rate-limit budget, so we skip the generic retry for it.
        """
        return getattr(self._inner, "name", "") != "openrouter"

    # BaseProvider API -------------------------------------------------------

    async def chat(
        self,
        messages: list[dict[str, Any]],
        system: str = "",
    ) -> str:
        start = time.perf_counter()
        response_text = ""
        error_text = ""
        activity = get_activity()
        caller = get_caller()
        pulsing = _agents_for_caller(caller)
        for a in pulsing:
            activity.begin(a)
        try:
            if self._should_retry():
                response_text = await with_retry(
                    lambda: self._inner.chat(messages=messages, system=system)
                )
            else:
                response_text = await self._inner.chat(messages=messages, system=system)
            return response_text
        except Exception as exc:
            error_text = str(exc)
            raise
        finally:
            for a in pulsing:
                activity.end(a)
            self._record_trace(
                messages=messages,
                system=system,
                response_text=response_text,
                error_text=error_text,
                duration_ms=int((time.perf_counter() - start) * 1000),
                caller=caller,
            )

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        system: str = "",
    ) -> AsyncIterator[str]:
        """Stream wrapper around the underlying ``chat_stream``.

        Accumulates chunks for the trace record so streamed calls still show
        up in ``/api/traces`` with the full assembled response after close.
        """
        start = time.perf_counter()
        chunks: list[str] = []
        error_text = ""
        activity = get_activity()
        caller = get_caller()
        pulsing = _agents_for_caller(caller)
        for a in pulsing:
            activity.begin(a)

        _DONE = object()

        async def _open_stream() -> tuple[AsyncIterator[str], Any]:
            """Open the stream and pull the first chunk.

            Retried as a unit so a transient connection failure restarts a
            fresh stream — but only the *first* chunk is gated this way. Once
            content has been delivered, we never replay: re-running a
            half-delivered stream would double-count tokens.
            """
            iterator = self._inner.chat_stream(messages=messages, system=system).__aiter__()
            try:
                first = await iterator.__anext__()
            except StopAsyncIteration:
                return iterator, _DONE
            return iterator, first

        try:
            if self._should_retry():
                iterator, first = await with_retry(_open_stream)
            else:
                iterator, first = await _open_stream()
            if first is not _DONE:
                chunks.append(first)
                yield first
                async for chunk in iterator:
                    chunks.append(chunk)
                    yield chunk
        except Exception as exc:
            error_text = str(exc)
            raise
        finally:
            for a in pulsing:
                activity.end(a)
            self._record_trace(
                messages=messages,
                system=system,
                response_text="".join(chunks),
                error_text=error_text,
                duration_ms=int((time.perf_counter() - start) * 1000),
                caller=caller,
            )

    async def embed(self, text: str) -> list[float]:
        if self._should_retry():
            return await with_retry(lambda: self._inner.embed(text))
        return await self._inner.embed(text)

    # Pass-through -----------------------------------------------------------

    def __getattr__(self, name: str) -> Any:
        # Called only when the attribute is not found on TracedProvider.
        # Avoid recursion on _inner before __init__ has set it.
        if name == "_inner":
            raise AttributeError(name)
        return getattr(self._inner, name)

    # Internal ---------------------------------------------------------------

    def _record_trace(
        self,
        *,
        messages: list[dict[str, Any]],
        system: str,
        response_text: str,
        error_text: str,
        duration_ms: int,
        caller: str,
    ) -> None:
        model = (
            getattr(self._inner, "_chat_model", None)
            or getattr(self._inner, "chat_model", None)
            or ""
        )
        try:
            get_trace_store().add(
                TraceRecord(
                    provider=self._provider_name,
                    model=str(model),
                    messages=list(messages),
                    system=system,
                    response=response_text,
                    duration_ms=duration_ms,
                    error=error_text,
                    caller=caller,
                )
            )
        except Exception:  # pragma: no cover - tracing must never break a chat call
            logger.debug("Failed to record trace", exc_info=True)

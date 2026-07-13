"""Helpers for the settings router — provider construction and masking."""

from pydantic import BaseModel

from core.config import ProviderConfig
from core.exceptions import ProviderConfigError
from core.providers.anthropic import AnthropicProvider
from core.providers.base import (
    AnthropicProviderConfig,
    BaseProvider,
    CodexProviderConfig,
    OllamaProviderConfig,
    OpenAICompatProviderConfig,
    OpenAIProviderConfig,
    OpenRouterProviderConfig,
    XAIProviderConfig,
)
from core.providers.codex import CodexProvider
from core.providers.ollama import OllamaProvider
from core.providers.openai import OpenAIProvider
from core.providers.openai_compatible import (
    DeepSeekProvider,
    GeminiProvider,
    GroqProvider,
    MistralProvider,
    OpenAICompatibleProvider,
    TogetherProvider,
)
from core.providers.openrouter import OpenRouterProvider
from core.providers.xai import XAIProvider

_LOCAL_PROVIDERS = frozenset({"codex", "ollama"})

#: OpenAI-compatible providers, mapped to their provider class. Each is built
#: the same way (shared config model); the class supplies the default base_url.
_OPENAI_COMPAT_PROVIDERS: dict[str, type[OpenAICompatibleProvider]] = {
    "groq": GroqProvider,
    "deepseek": DeepSeekProvider,
    "together": TogetherProvider,
    "mistral": MistralProvider,
    "gemini": GeminiProvider,
}


class ProviderInput(BaseModel):
    """A single provider entry from the frontend."""

    name: str
    type: str  # "cloud" | "local"
    api_key: str = ""
    host: str = ""
    base_url: str = ""
    chat_model: str = ""
    embed_model: str = ""
    is_default: bool = False


def provider_type(name: str) -> str:
    return "local" if name in _LOCAL_PROVIDERS else "cloud"


def mask_api_key(key: str | None) -> tuple[str, bool]:
    if not key:
        return "", False
    if len(key) <= 4:
        return "…", True
    return f"…{key[-4:]}", True


def build_provider_from_input(p: ProviderInput) -> BaseProvider:
    """Build a provider instance directly from frontend-supplied config.

    Bypasses the registry (and therefore disk) so unsaved keys can be
    sanity-checked. Raises ProviderConfigError for unknown providers or
    missing required credentials.
    """
    if p.name == "codex":
        return CodexProvider(CodexProviderConfig(chat_model=p.chat_model or "default"))
    if p.name == "openai":
        return OpenAIProvider(
            OpenAIProviderConfig(
                api_key=p.api_key or None,
                chat_model=p.chat_model or "gpt-4o",
                embed_model=p.embed_model or "text-embedding-3-small",
            )
        )
    if p.name == "anthropic":
        return AnthropicProvider(
            AnthropicProviderConfig(
                api_key=p.api_key or None,
                chat_model=p.chat_model or "claude-sonnet-4-20250514",
            )
        )
    if p.name == "ollama":
        return OllamaProvider(
            OllamaProviderConfig(
                host=p.host or "http://localhost:11434",
                chat_model=p.chat_model or "llama3",
                embed_model=p.embed_model or "nomic-embed-text",
            )
        )
    if p.name == "xai":
        return XAIProvider(
            XAIProviderConfig(
                api_key=p.api_key or None,
                base_url=p.base_url or "https://api.x.ai/v1",
                chat_model=p.chat_model or "grok-3",
                embed_model=p.embed_model or None,
            )
        )
    if p.name == "openrouter":
        return OpenRouterProvider(
            OpenRouterProviderConfig(
                api_key=p.api_key or None,
                base_url=p.base_url or "https://openrouter.ai/api/v1",
                chat_model=p.chat_model or "openai/gpt-4o-mini",
            )
        )
    compat_cls = _OPENAI_COMPAT_PROVIDERS.get(p.name)
    if compat_cls is not None:
        return compat_cls(
            OpenAICompatProviderConfig(
                api_key=p.api_key or None,
                base_url=p.base_url or "",  # blank => provider's default endpoint
                chat_model=p.chat_model or "",
                embed_model=p.embed_model or None,
            )
        )
    raise ProviderConfigError(f"Unknown provider '{p.name}'.")


def provider_input_from_saved(
    name: str,
    existing: ProviderConfig | None,
    *,
    chat_model: str | None = None,
) -> ProviderInput:
    """Build a ProviderInput seeded from the saved config for ``name``.

    Single construction point for the "probe a provider from its stored
    settings" endpoints (model listing, benchmarking). ``chat_model``
    overrides the saved model so arbitrary models can be probed without
    touching settings.
    """
    return ProviderInput(
        name=name,
        type=provider_type(name),
        api_key=(existing.api_key if existing else "") or "",
        host=(existing.host if existing else "") or "",
        base_url=(existing.base_url if existing else "") or "",
        chat_model=chat_model
        if chat_model is not None
        else (existing.chat_model if existing else ""),
        embed_model=(existing.embed_model if existing else "") or "",
    )

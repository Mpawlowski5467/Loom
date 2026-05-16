"""Helpers for the settings router — provider construction and masking."""

from pydantic import BaseModel

from core.exceptions import ProviderConfigError
from core.providers.anthropic import AnthropicProvider
from core.providers.base import (
    AnthropicProviderConfig,
    BaseProvider,
    OllamaProviderConfig,
    OpenAIProviderConfig,
    XAIProviderConfig,
)
from core.providers.ollama import OllamaProvider
from core.providers.openai import OpenAIProvider
from core.providers.xai import XAIProvider

_LOCAL_PROVIDERS = frozenset({"ollama"})


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
    raise ProviderConfigError(f"Unknown provider '{p.name}'.")

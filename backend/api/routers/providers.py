"""``/api/providers`` — wizard-facing provider endpoints (list, test, models).

The full settings UI uses ``/api/settings/providers``; this router stays
narrow: list the known provider names, test credentials without saving
them first, and list a provider's available models.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.routers.settings_helpers import (
    ProviderInput,
    build_provider_from_input,
    provider_input_from_saved,
    provider_type,
)
from core.config import GlobalConfig, ProviderConfigPublic, settings
from core.exceptions import ProviderConfigError
from core.model_advisor import is_embed_model_name

router = APIRouter(prefix="/api/providers", tags=["providers"])

_KNOWN: list[str] = [
    "openai",
    "anthropic",
    "xai",
    "openrouter",
    "ollama",
    "groq",
    "deepseek",
    "together",
    "mistral",
    "gemini",
]

_DEFAULT_OLLAMA_HOST = "http://localhost:11434"
_OLLAMA_TAGS_TIMEOUT_S = 4.0
_MODELS_LIST_TIMEOUT_S = 5.0

#: Static fallbacks when a live listing is unavailable (no key, API error).
#: Anthropic has no OpenAI-compatible /models endpoint, so it is always static.
_KNOWN_MODELS: dict[str, dict[str, list[str]]] = {
    "openai": {
        "chat": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
        "embed": ["text-embedding-3-small", "text-embedding-3-large"],
    },
    "anthropic": {
        "chat": [
            "claude-sonnet-4-20250514",
            "claude-opus-4-20250514",
            "claude-3-5-haiku-20241022",
        ],
        "embed": [],
    },
    "xai": {"chat": ["grok-3", "grok-3-mini"], "embed": []},
    "openrouter": {
        "chat": ["openai/gpt-4o-mini", "qwen/qwen3-next-80b-a3b-instruct:free"],
        "embed": [],
    },
    "ollama": {"chat": [], "embed": []},
    "groq": {"chat": ["llama-3.3-70b-versatile"], "embed": []},
    "deepseek": {"chat": ["deepseek-chat", "deepseek-reasoner"], "embed": []},
    "together": {"chat": ["meta-llama/Llama-3.3-70B-Instruct-Turbo"], "embed": []},
    "mistral": {
        "chat": ["mistral-large-latest", "mistral-small-latest"],
        "embed": ["mistral-embed"],
    },
    "gemini": {"chat": ["gemini-2.0-flash", "gemini-2.5-pro"], "embed": ["text-embedding-004"]},
}


class ProvidersResponse(BaseModel):
    default: str
    providers: dict[str, ProviderConfigPublic]
    known: list[str]


class ProviderTestRequest(BaseModel):
    """Optional overrides for a pre-save test."""

    api_key: str | None = None
    host: str | None = None


class ModelInfo(BaseModel):
    """One selectable model (mirrors the frontend ``ModelInfo`` type)."""

    id: str
    name: str
    type: Literal["chat", "embed"]


class ModelsResponse(BaseModel):
    """Models a provider offers, split by capability."""

    chat: list[ModelInfo]
    embed: list[ModelInfo]


class TestProviderResponse(BaseModel):
    ok: bool
    latency_ms: int = 0
    error: str | None = None


@router.get("", response_model=ProvidersResponse)
async def list_providers() -> ProvidersResponse:
    """Return the redacted provider config plus the list of known names."""
    cfg = GlobalConfig.load(settings.config_path)
    return ProvidersResponse(
        default=cfg.default_provider,
        providers={name: p.to_public() for name, p in cfg.providers.items()},
        known=list(_KNOWN),
    )


def _validate_known(name: str) -> None:
    if name not in _KNOWN:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown provider: {name}")


@router.post("/{name}/test", response_model=TestProviderResponse)
async def test_provider(
    name: str, payload: ProviderTestRequest | None = None
) -> TestProviderResponse:
    """Test credentials against a provider without persisting them.

    Pulls the stored config off disk as a baseline, layers any overrides
    from the request body on top (so the user can sanity-check an unsaved
    key), and pings the provider. Errors return ``ok=False`` in the body
    so the UI can render them inline — they don't bubble up as HTTP errors.
    """
    _validate_known(name)
    body = payload or ProviderTestRequest()
    cfg = GlobalConfig.load(settings.config_path)
    existing = cfg.providers.get(name)

    runtime = ProviderInput(
        name=name,
        type=provider_type(name),
        api_key=body.api_key
        if body.api_key is not None
        else (existing.api_key if existing else "") or "",
        host=body.host if body.host is not None else (existing.host if existing else "") or "",
        chat_model=existing.chat_model if existing else "",
        embed_model=(existing.embed_model if existing else "") or "",
    )

    start = time.perf_counter()
    try:
        provider = build_provider_from_input(runtime)
    except ProviderConfigError as exc:
        return TestProviderResponse(ok=False, latency_ms=0, error=str(exc))

    def _elapsed_ms() -> int:
        return int((time.perf_counter() - start) * 1000)

    try:
        if runtime.embed_model:
            await asyncio.wait_for(provider.embed("ping"), timeout=10.0)
        else:
            await asyncio.wait_for(
                provider.chat(
                    [{"role": "user", "content": "ping"}],
                    system="Reply with one word: pong",
                ),
                timeout=10.0,
            )
        return TestProviderResponse(ok=True, latency_ms=_elapsed_ms())
    except TimeoutError:
        return TestProviderResponse(
            ok=False,
            latency_ms=_elapsed_ms(),
            error="Timed out after 10s",
        )
    except Exception as exc:  # noqa: BLE001 — surface any provider error to the UI
        return TestProviderResponse(ok=False, latency_ms=_elapsed_ms(), error=str(exc))
    finally:
        if hasattr(provider, "close"):
            with contextlib.suppress(Exception):
                await provider.close()


# -- Model listing -------------------------------------------------------------


def ollama_host(cfg: GlobalConfig) -> str:
    """The configured Ollama host, defaulting to localhost."""
    existing = cfg.providers.get("ollama")
    return (existing.host if existing else None) or _DEFAULT_OLLAMA_HOST


async def fetch_ollama_tags(host: str) -> list[dict[str, Any]]:
    """Return the raw model dicts from an Ollama host's ``/api/tags``.

    Raises ``httpx.HTTPError`` (or ``ValueError`` on bad JSON) — callers
    decide how to degrade.
    """
    async with httpx.AsyncClient(
        base_url=host.rstrip("/"), timeout=_OLLAMA_TAGS_TIMEOUT_S
    ) as client:
        resp = await client.get("/api/tags")
        resp.raise_for_status()
        data = resp.json()
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list):
        return []
    return [m for m in models if isinstance(m, dict)]


def _split_by_capability(ids: list[str]) -> ModelsResponse:
    """Classify model ids into chat/embed lists by name."""
    chat: list[ModelInfo] = []
    embed: list[ModelInfo] = []
    for model_id in ids:
        kind: Literal["chat", "embed"] = "embed" if is_embed_model_name(model_id) else "chat"
        target = embed if kind == "embed" else chat
        target.append(ModelInfo(id=model_id, name=model_id, type=kind))
    return ModelsResponse(chat=chat, embed=embed)


def _static_models(name: str) -> ModelsResponse:
    known = _KNOWN_MODELS.get(name, {"chat": [], "embed": []})
    return ModelsResponse(
        chat=[ModelInfo(id=m, name=m, type="chat") for m in known["chat"]],
        embed=[ModelInfo(id=m, name=m, type="embed") for m in known["embed"]],
    )


async def _ollama_models(cfg: GlobalConfig) -> ModelsResponse:
    try:
        tags = await fetch_ollama_tags(ollama_host(cfg))
    except (httpx.HTTPError, ValueError):
        return ModelsResponse(chat=[], embed=[])
    names = [str(m.get("name") or m.get("model") or "") for m in tags]
    return _split_by_capability([n for n in names if n])


async def _openai_compatible_models(name: str, cfg: GlobalConfig) -> ModelsResponse:
    """Live ``models.list()`` via the provider's OpenAI-compatible client.

    Falls back to the static known-model list when the provider can't be
    built (no key) or the listing call fails.
    """
    runtime = provider_input_from_saved(name, cfg.providers.get(name))
    try:
        provider = build_provider_from_input(runtime)
    except ProviderConfigError:
        return _static_models(name)
    try:
        client = getattr(provider, "_client", None)
        if client is None or not hasattr(client, "models"):
            return _static_models(name)
        page = await asyncio.wait_for(client.models.list(), timeout=_MODELS_LIST_TIMEOUT_S)
        ids = sorted({str(m.id) for m in page.data if getattr(m, "id", None)})
        if not ids:
            return _static_models(name)
        return _split_by_capability(ids)
    except Exception:  # noqa: BLE001 — any listing failure degrades to the static list
        return _static_models(name)
    finally:
        if hasattr(provider, "close"):
            with contextlib.suppress(Exception):
                await provider.close()


@router.get("/{name}/models", response_model=ModelsResponse)
async def list_models(name: str) -> ModelsResponse:
    """List a provider's available models, split into chat and embed.

    Ollama is queried live via ``/api/tags`` (empty lists when unreachable);
    Anthropic is a static list; the OpenAI-compatible cloud providers try a
    live ``models.list()`` and fall back to a static shortlist.
    """
    _validate_known(name)
    cfg = GlobalConfig.load(settings.config_path)
    if name == "ollama":
        return await _ollama_models(cfg)
    if name == "anthropic":
        return _static_models("anthropic")
    return await _openai_compatible_models(name, cfg)

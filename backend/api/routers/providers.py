"""``/api/providers`` — wizard-facing provider endpoints (list + test).

The full settings UI uses ``/api/settings/providers``; this router stays
narrow on what the onboarding wizard actually needs: list the known
provider names and test credentials without saving them first.
"""

from __future__ import annotations

import asyncio
import contextlib
import time

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.routers.settings_helpers import ProviderInput, build_provider_from_input, provider_type
from core.config import GlobalConfig, ProviderConfigPublic, settings
from core.exceptions import ProviderConfigError

router = APIRouter(prefix="/api/providers", tags=["providers"])

_KNOWN: list[str] = ["openai", "anthropic", "xai", "openrouter", "ollama"]


class ProvidersResponse(BaseModel):
    default: str
    providers: dict[str, ProviderConfigPublic]
    known: list[str]


class ProviderTestRequest(BaseModel):
    """Optional overrides for a pre-save test."""

    api_key: str | None = None
    host: str | None = None


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

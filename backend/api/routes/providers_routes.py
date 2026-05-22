"""``/api/providers`` — CRUD + test + model listing for AI providers."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict

from api.deps import get_config, write_config
from core.config import LoomConfig, ProviderConfig, ProviderConfigPublic
from core.exceptions import ProviderError, UnknownProviderError
from providers import (
    ModelInfo,
    TestProviderResponse,
    get_provider,
    known_provider_names,
)

router = APIRouter(prefix="/api/providers", tags=["providers"])


class ProvidersResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default: str
    providers: dict[str, ProviderConfigPublic]
    known: list[str]


class ProviderUpsert(BaseModel):
    """PUT payload for a single provider. ``api_key`` is optional so the UI
    can update other fields without re-sending the key."""

    model_config = ConfigDict(extra="forbid")

    api_key: str | None = None
    chat_model: str | None = None
    embed_model: str | None = None
    host: str | None = None


class ProviderTestRequest(BaseModel):
    """Optional overrides for a pre-save test."""

    model_config = ConfigDict(extra="forbid")

    api_key: str | None = None
    host: str | None = None


class ModelsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat: list[ModelInfo]
    embed: list[ModelInfo]


def _validate_known(name: str) -> None:
    if name not in known_provider_names():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown provider: {name}")


@router.get("", response_model=ProvidersResponse)
async def list_providers(
    config: Annotated[LoomConfig, Depends(get_config)],
) -> ProvidersResponse:
    public = {n: cfg.to_public() for n, cfg in config.providers.items()}
    return ProvidersResponse(
        default=config.default_provider,
        providers=public,
        known=known_provider_names(),
    )


@router.put("/{name}", response_model=ProviderConfigPublic)
async def upsert_provider(
    name: str,
    payload: ProviderUpsert,
    config: Annotated[LoomConfig, Depends(get_config)],
) -> ProviderConfigPublic:
    _validate_known(name)
    updated = config.model_copy(deep=True)
    existing = updated.providers.get(name, ProviderConfig())
    merged = ProviderConfig(
        api_key=payload.api_key if payload.api_key is not None else existing.api_key,
        chat_model=(payload.chat_model if payload.chat_model is not None else existing.chat_model),
        embed_model=(
            payload.embed_model if payload.embed_model is not None else existing.embed_model
        ),
        host=payload.host if payload.host is not None else existing.host,
    )
    updated.providers[name] = merged
    return write_config(updated).providers[name].to_public()


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    name: str,
    config: Annotated[LoomConfig, Depends(get_config)],
) -> None:
    _validate_known(name)
    if name not in config.providers:
        return None
    updated = config.model_copy(deep=True)
    updated.providers.pop(name, None)
    write_config(updated)
    return None


@router.post("/{name}/test", response_model=TestProviderResponse)
async def test_provider(
    name: str,
    payload: ProviderTestRequest | None,
    config: Annotated[LoomConfig, Depends(get_config)],
) -> TestProviderResponse:
    _validate_known(name)
    existing = config.providers.get(name, ProviderConfig())
    body = payload or ProviderTestRequest()
    runtime = ProviderConfig(
        api_key=body.api_key if body.api_key is not None else existing.api_key,
        chat_model=existing.chat_model,
        embed_model=existing.embed_model,
        host=body.host if body.host is not None else existing.host,
    )
    provider = get_provider(name, runtime)
    return await provider.test()


@router.get("/{name}/models", response_model=ModelsResponse)
async def list_models(
    name: str,
    config: Annotated[LoomConfig, Depends(get_config)],
    type: Annotated[Literal["chat", "embed", "all"], Query()] = "all",
) -> ModelsResponse:
    _validate_known(name)
    existing = config.providers.get(name, ProviderConfig())
    try:
        provider = get_provider(name, existing)
        chat, embed = await provider.list_models()
    except UnknownProviderError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(exc.status_code, detail=exc.message) from exc

    if type == "chat":
        embed = []
    elif type == "embed":
        chat = []
    return ModelsResponse(chat=chat, embed=embed)

"""``/api/onboarding`` — first-run gate + atomic completion."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict

from api.deps import get_config, write_config
from core.config import (
    LoomConfig,
    LoomConfigPublic,
    OnboardingState,
    ProviderConfig,
    ThemeName,
)
from core.exceptions import VaultExistsError
from core.vault import create_vault, vault_exists
from providers import known_provider_names

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class OnboardingProviderPayload(BaseModel):
    """Optional provider info gathered during the wizard."""

    model_config = ConfigDict(extra="forbid")

    name: str
    api_key: str | None = None
    chat_model: str | None = None
    embed_model: str | None = None
    host: str | None = None


class OnboardingCompleteRequest(BaseModel):
    """All state captured by the wizard.

    Backend treats this as a transaction: writes happen against an in-memory
    draft and only persist with a single ``save()`` at the end.
    """

    model_config = ConfigDict(extra="forbid")

    theme: ThemeName = ThemeName.paper
    vault_name: str = "default"
    overwrite_existing_vault: bool = False
    provider: OnboardingProviderPayload | None = None
    steps_done: list[str] = []


@router.get("/status", response_model=OnboardingState)
async def get_status(
    config: Annotated[LoomConfig, Depends(get_config)],
) -> OnboardingState:
    return config.onboarding


@router.post("/complete", response_model=LoomConfigPublic)
async def complete_onboarding(
    payload: OnboardingCompleteRequest,
    config: Annotated[LoomConfig, Depends(get_config)],
) -> LoomConfigPublic:
    draft = config.model_copy(deep=True)

    # Theme.
    draft.ui.theme = payload.theme

    # Vault — create if missing/unscaffolded; raise on conflict unless
    # overwrite was explicitly requested.
    exists, scaffolded = vault_exists(draft.loom_dir, payload.vault_name)
    needs_scaffold = (not exists) or (not scaffolded)
    if needs_scaffold or payload.overwrite_existing_vault:
        try:
            create_vault(
                draft.loom_dir,
                payload.vault_name,
                overwrite=payload.overwrite_existing_vault,
            )
        except VaultExistsError as exc:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "name": exc.name,
                    "scaffolded": exc.scaffolded,
                    "message": str(exc),
                },
            ) from exc
    draft.active_vault = payload.vault_name

    # Provider (optional — user can skip).
    if payload.provider is not None:
        prov = payload.provider
        if prov.name not in known_provider_names():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown provider: {prov.name}",
            )
        existing = draft.providers.get(prov.name, ProviderConfig())
        merged = ProviderConfig(
            api_key=prov.api_key if prov.api_key is not None else existing.api_key,
            chat_model=(prov.chat_model if prov.chat_model is not None else existing.chat_model),
            embed_model=(
                prov.embed_model if prov.embed_model is not None else existing.embed_model
            ),
            host=prov.host if prov.host is not None else existing.host,
        )
        draft.providers[prov.name] = merged
        draft.default_provider = prov.name

    # Onboarding gate.
    draft.onboarding = OnboardingState(
        completed=True,
        completed_at=datetime.now(UTC),
        steps_done=payload.steps_done,
    )

    return write_config(draft).to_public()

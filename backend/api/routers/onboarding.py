"""``/api/onboarding`` — first-run wizard status + atomic completion."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from core.config import (
    GlobalConfig,
    GlobalConfigPublic,
    OnboardingState,
    ProviderConfig,
    ThemeName,
    settings,
)
from core.exceptions import InvalidVaultNameError, VaultExistsError
from core.vault import get_vault_manager

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class OnboardingProviderPayload(BaseModel):
    """Optional provider info gathered during the wizard."""

    name: str
    api_key: str | None = None
    chat_model: str | None = None
    embed_model: str | None = None
    host: str | None = None


class OnboardingCompleteRequest(BaseModel):
    """All state captured by the wizard."""

    theme: ThemeName = ThemeName.paper
    vault_name: str = "default"
    overwrite_existing_vault: bool = False
    provider: OnboardingProviderPayload | None = None
    steps_done: list[str] = []


_KNOWN_PROVIDERS = {"openai", "anthropic", "xai", "ollama"}


@router.get("/status", response_model=OnboardingState)
async def get_status() -> OnboardingState:
    """Return the onboarding gate state."""
    return GlobalConfig.load(settings.config_path).onboarding


@router.post("/complete", response_model=GlobalConfigPublic)
async def complete_onboarding(payload: OnboardingCompleteRequest) -> GlobalConfigPublic:
    """Persist everything the wizard collected: theme, vault, provider, gate.

    Vault creation goes through :class:`VaultManager` so the new vault gets the
    full default scaffold (threads, agents, rules, prompts, .loom metadata).
    """
    config = GlobalConfig.load(settings.config_path)
    config.ui.theme = payload.theme

    vm = get_vault_manager()
    if not vm.vault_exists(payload.vault_name):
        try:
            vm.init_vault(payload.vault_name)
        except VaultExistsError as exc:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={"name": exc.name, "message": str(exc)},
            ) from exc
        except InvalidVaultNameError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
    elif payload.overwrite_existing_vault:
        # Vault already exists and the user explicitly opted to overwrite.
        # We don't actually clobber data here — the scaffold is idempotent.
        # If we ever support destructive overwrite, that work goes here.
        pass

    config.active_vault = payload.vault_name

    if payload.provider is not None:
        prov = payload.provider
        if prov.name not in _KNOWN_PROVIDERS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown provider: {prov.name}",
            )
        existing = config.providers.get(prov.name, ProviderConfig())
        config.providers[prov.name] = ProviderConfig(
            api_key=prov.api_key if prov.api_key is not None else existing.api_key,
            chat_model=prov.chat_model or existing.chat_model,
            embed_model=prov.embed_model if prov.embed_model is not None else existing.embed_model,
            host=prov.host if prov.host is not None else existing.host,
        )
        config.default_provider = prov.name
        # Wire the picked provider into the runtime defaults so agents/indexer
        # can find it without a second pass through the Settings UI.
        if prov.chat_model:
            config.chat_provider = prov.name
        if prov.embed_model:
            config.embed_provider = prov.name

    config.onboarding = OnboardingState(
        completed=True,
        completed_at=datetime.now(UTC),
        steps_done=payload.steps_done,
    )
    config.save(settings.config_path)
    return config.to_public()

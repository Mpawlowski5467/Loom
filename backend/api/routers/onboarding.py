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
    base_url: str | None = None


class OnboardingCompleteRequest(BaseModel):
    """All state captured by the wizard.

    Accepts both the legacy single-provider shape (``provider``) and the
    new multi-provider shape (``providers`` + ``chat_provider`` /
    ``embed_provider``). New clients should send ``providers``; the
    server treats ``provider`` as a one-element list for backwards
    compatibility.
    """

    theme: ThemeName = ThemeName.paper
    vault_name: str = "default"
    overwrite_existing_vault: bool = False
    provider: OnboardingProviderPayload | None = None
    providers: list[OnboardingProviderPayload] = []
    chat_provider: str | None = None
    embed_provider: str | None = None
    steps_done: list[str] = []


_KNOWN_PROVIDERS = {"openai", "anthropic", "xai", "ollama", "openrouter"}


@router.get("/status", response_model=OnboardingState)
async def get_status() -> OnboardingState:
    """Return the onboarding gate state."""
    return GlobalConfig.load(settings.config_path).onboarding


@router.post("/reset", response_model=GlobalConfigPublic)
async def reset_onboarding() -> GlobalConfigPublic:
    """Mark onboarding incomplete without deleting vault or provider data."""
    config = GlobalConfig.load(settings.config_path)
    config.onboarding = OnboardingState(completed=False, completed_at=None, steps_done=[])
    config.save(settings.config_path)
    return config.to_public()


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

    # Normalize legacy single-provider shape into the new providers list.
    providers = list(payload.providers)
    if payload.provider is not None and not providers:
        providers = [payload.provider]

    for prov in providers:
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
            base_url=prov.base_url if prov.base_url is not None else existing.base_url,
        )

    if providers:
        chat_pick = payload.chat_provider or next(
            (p.name for p in providers if p.chat_model), providers[0].name
        )
        embed_pick = payload.embed_provider or next(
            (p.name for p in providers if p.embed_model), chat_pick
        )
        if chat_pick not in _KNOWN_PROVIDERS or embed_pick not in _KNOWN_PROVIDERS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Default chat/embed provider must be one of the configured providers.",
            )
        config.default_provider = chat_pick
        config.chat_provider = chat_pick
        config.embed_provider = embed_pick

    config.onboarding = OnboardingState(
        completed=True,
        completed_at=datetime.now(UTC),
        steps_done=payload.steps_done,
    )
    config.save(settings.config_path)
    return config.to_public()

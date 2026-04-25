"""Settings API routes — provider configuration management."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import GlobalConfig, ProviderConfig, settings
from core.providers import reset_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["settings"])


# -- Request / Response models ------------------------------------------------


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


class SaveProvidersRequest(BaseModel):
    """Request body for updating provider configuration."""

    providers: list[ProviderInput] = Field(min_length=1)


class SaveProvidersResponse(BaseModel):
    """Confirmation returned after saving providers."""

    saved: int
    default_chat_provider: str | None = None
    default_embed_provider: str | None = None


class ProviderOutput(BaseModel):
    """A provider entry as returned to the frontend (api_key masked)."""

    name: str
    type: str
    api_key: str = ""
    api_key_set: bool = False
    host: str = ""
    base_url: str = ""
    chat_model: str = ""
    embed_model: str = ""
    is_default_chat: bool = False
    is_default_embed: bool = False


class GetProvidersResponse(BaseModel):
    """Current provider configuration."""

    providers: list[ProviderOutput]
    active_vault: str


# -- Helpers ------------------------------------------------------------------


_LOCAL_PROVIDERS = frozenset({"ollama"})


def _provider_type(name: str) -> str:
    return "local" if name in _LOCAL_PROVIDERS else "cloud"


def _mask_api_key(key: str | None) -> tuple[str, bool]:
    if not key:
        return "", False
    if len(key) <= 4:
        return "…", True
    return f"…{key[-4:]}", True


# -- Endpoints ----------------------------------------------------------------


@router.get("/settings/providers")
async def get_providers() -> GetProvidersResponse:
    """Return the current provider configuration.

    API keys are masked so the modal can display "key is set" without
    leaking the actual value back to the client.
    """
    cfg = GlobalConfig.load(settings.config_path)

    out: list[ProviderOutput] = []
    for name, p in cfg.providers.items():
        masked, has_key = _mask_api_key(p.api_key)
        out.append(
            ProviderOutput(
                name=name,
                type=_provider_type(name),
                api_key=masked,
                api_key_set=has_key,
                host=p.host or "",
                base_url=getattr(p, "base_url", "") or "",
                chat_model=p.chat_model or "",
                embed_model=p.embed_model or "",
                is_default_chat=cfg.chat_provider == name,
                is_default_embed=cfg.embed_provider == name,
            )
        )

    return GetProvidersResponse(providers=out, active_vault=cfg.active_vault)


@router.post("/settings/providers")
async def save_providers(body: SaveProvidersRequest) -> SaveProvidersResponse:
    """Persist provider configuration to ~/.loom/config.yaml.

    Accepts the full provider list from the frontend settings UI,
    maps it onto the backend GlobalConfig format, saves to disk,
    and resets the provider registry so new settings take effect
    immediately. An empty ``api_key`` for an existing provider is
    treated as "no change" so the masked-key UX doesn't wipe credentials.
    """
    config_path = settings.config_path
    cfg = GlobalConfig.load(config_path)
    existing = cfg.providers

    if not body.providers:
        raise HTTPException(status_code=400, detail="At least one provider is required")

    providers: dict[str, ProviderConfig] = {}
    chat_provider: str | None = None
    embed_provider: str | None = None
    fallback_chat: str | None = None
    fallback_embed: str | None = None

    for p in body.providers:
        prior = existing.get(p.name)
        api_key = p.api_key or (prior.api_key if prior else None)
        pc = ProviderConfig(
            api_key=api_key,
            chat_model=p.chat_model or (prior.chat_model if prior else "gpt-4o"),
            embed_model=p.embed_model or (prior.embed_model if prior else None),
            host=p.host or (prior.host if prior else None),
        )
        providers[p.name] = pc

        if p.is_default:
            if p.chat_model:
                chat_provider = p.name
            if p.embed_model:
                embed_provider = p.name

        # Pick a credible fallback for when nothing is marked default.
        has_credentials = bool(api_key) or bool(pc.host)
        if fallback_chat is None and pc.chat_model and has_credentials:
            fallback_chat = p.name
        if fallback_embed is None and pc.embed_model and has_credentials:
            fallback_embed = p.name

    cfg.providers = providers
    cfg.chat_provider = chat_provider or fallback_chat
    cfg.embed_provider = embed_provider or fallback_embed

    cfg.save(config_path)
    logger.info(
        "Provider config saved — %d providers, chat=%s, embed=%s",
        len(providers),
        cfg.chat_provider,
        cfg.embed_provider,
    )

    await reset_registry()

    return SaveProvidersResponse(
        saved=len(providers),
        default_chat_provider=cfg.chat_provider,
        default_embed_provider=cfg.embed_provider,
    )

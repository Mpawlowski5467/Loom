"""Settings API routes — provider configuration management."""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

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
    chat_model: str = ""
    embed_model: str = ""
    is_default: bool = False


class SaveProvidersRequest(BaseModel):
    """Request body for updating provider configuration."""

    providers: list[ProviderInput]


class SaveProvidersResponse(BaseModel):
    """Confirmation returned after saving providers."""

    saved: int
    default_chat_provider: str | None = None
    default_embed_provider: str | None = None


# -- Endpoints ----------------------------------------------------------------


@router.post("/settings/providers")
async def save_providers(body: SaveProvidersRequest) -> SaveProvidersResponse:
    """Persist provider configuration to ~/.loom/config.yaml.

    Accepts the full provider list from the frontend settings UI,
    maps it onto the backend GlobalConfig format, saves to disk,
    and resets the provider registry so new settings take effect
    immediately.
    """
    config_path = settings.config_path
    cfg = GlobalConfig.load(config_path)

    # Rebuild providers dict from frontend payload
    providers: dict[str, ProviderConfig] = {}
    chat_provider: str | None = None
    embed_provider: str | None = None

    for p in body.providers:
        pc = ProviderConfig(
            api_key=p.api_key or None,
            chat_model=p.chat_model or "gpt-4o",
            embed_model=p.embed_model or None,
            host=p.host or None,
        )
        providers[p.name] = pc

        if p.is_default:
            if p.chat_model:
                chat_provider = p.name
            if p.embed_model:
                embed_provider = p.name

    cfg.providers = providers
    cfg.chat_provider = chat_provider
    cfg.embed_provider = embed_provider

    cfg.save(config_path)
    logger.info(
        "Provider config saved — %d providers, chat=%s, embed=%s",
        len(providers),
        chat_provider,
        embed_provider,
    )

    reset_registry()

    return SaveProvidersResponse(
        saved=len(providers),
        default_chat_provider=chat_provider,
        default_embed_provider=embed_provider,
    )

"""``/api/config`` — read + partial update of the global config.

Exposes the persisted YAML config (``~/.loom/config.yaml``) to the frontend.
API keys are redacted via :meth:`GlobalConfig.to_public`.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from core.config import GlobalConfig, GlobalConfigPublic, ThemeName, settings

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigPatch(BaseModel):
    """Fields that can be PATCHed against the config."""

    theme: ThemeName | None = None
    active_vault: str | None = None
    default_provider: str | None = None


@router.get("", response_model=GlobalConfigPublic)
async def get_config_route() -> GlobalConfigPublic:
    """Return the current config, with API keys redacted."""
    return GlobalConfig.load(settings.config_path).to_public()


@router.patch("", response_model=GlobalConfigPublic)
async def patch_config_route(patch: ConfigPatch) -> GlobalConfigPublic:
    """Apply a partial update to the config and persist atomically."""
    config = GlobalConfig.load(settings.config_path)
    if patch.theme is not None:
        config.ui.theme = patch.theme
    if patch.active_vault is not None:
        config.active_vault = patch.active_vault
    if patch.default_provider is not None:
        config.default_provider = patch.default_provider
    config.save(settings.config_path)
    return config.to_public()

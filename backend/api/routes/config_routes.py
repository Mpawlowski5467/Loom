"""``/api/config`` — read + partial update of the global config."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from api.deps import get_config, write_config
from core.config import LoomConfig, LoomConfigPublic, ThemeName

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigPatch(BaseModel):
    """Fields that can be PATCHed against the config."""

    model_config = ConfigDict(extra="forbid")

    theme: ThemeName | None = None
    active_vault: str | None = None
    default_provider: str | None = None


@router.get("", response_model=LoomConfigPublic)
async def get_config_route(
    config: Annotated[LoomConfig, Depends(get_config)],
) -> LoomConfigPublic:
    return config.to_public()


@router.patch("", response_model=LoomConfigPublic)
async def patch_config_route(
    patch: ConfigPatch,
    config: Annotated[LoomConfig, Depends(get_config)],
) -> LoomConfigPublic:
    updated = config.model_copy(deep=True)
    if patch.theme is not None:
        updated.ui.theme = patch.theme
    if patch.active_vault is not None:
        updated.active_vault = patch.active_vault
    if patch.default_provider is not None:
        updated.default_provider = patch.default_provider
    return write_config(updated).to_public()

"""``/api/config`` — read + partial update of the global config.

Exposes the persisted YAML config (``~/.loom/config.yaml``) to the frontend.
API keys are redacted via :meth:`GlobalConfig.to_public`.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.runtime import reload_active_vault_runtime
from core.config import GlobalConfig, GlobalConfigPublic, ThemeName
from core.exceptions import InvalidVaultNameError, VaultNotFoundError
from core.note_index import NoteIndex, get_note_index
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/config", tags=["config"])


class ConfigPatch(BaseModel):
    """Fields that can be PATCHed against the config."""

    theme: ThemeName | None = None
    active_vault: str | None = None
    default_provider: str | None = None


@router.get("", response_model=GlobalConfigPublic)
async def get_config_route(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GlobalConfigPublic:
    """Return the current config, with API keys redacted."""
    return GlobalConfig.load(vm.config_path()).to_public()


@router.patch("", response_model=GlobalConfigPublic)
async def patch_config_route(
    patch: ConfigPatch,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> GlobalConfigPublic:
    """Apply a partial update to the config and persist atomically."""
    config = GlobalConfig.load(vm.config_path())
    if patch.theme is not None:
        config.ui.theme = patch.theme
    if patch.active_vault is not None:
        try:
            vm.validate_vault_name(patch.active_vault)
            vm.set_active_vault(patch.active_vault)
        except InvalidVaultNameError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        except VaultNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        config = GlobalConfig.load(vm.config_path())
        try:
            reload_active_vault_runtime(
                vm,
                loop=asyncio.get_running_loop(),
                note_index=index,
            )
        except Exception as e:
            raise HTTPException(
                status_code=409,
                detail=f"Could not reload active vault runtime: {e}",
            ) from e
    if patch.default_provider is not None:
        config.default_provider = patch.default_provider
    config.save(vm.config_path())
    return config.to_public()

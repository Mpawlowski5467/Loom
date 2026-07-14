"""``/api/config`` — read + partial update of the global config.

Exposes the persisted YAML config (``~/.loom/config.yaml``) to the frontend.
API keys are redacted via :meth:`GlobalConfig.to_public`.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.runtime import reload_active_vault_runtime
from core.capture_jobs import get_capture_job_service
from core.config import GlobalConfig, GlobalConfigPublic, ThemeName
from core.exceptions import InvalidVaultNameError, VaultNotFoundError
from core.note_index import NoteIndex, get_note_index
from core.vault import VaultManager, get_vault_manager
from core.vault_handoff import VaultHandoffBusyError, active_vault_handoff

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
        old_active = vm.get_active_vault()
        vault_changed = patch.active_vault != old_active
        try:
            vm.validate_vault_name(patch.active_vault)
        except InvalidVaultNameError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        if vault_changed:
            if not vm.vault_exists(patch.active_vault):
                raise HTTPException(
                    status_code=404,
                    detail=str(VaultNotFoundError(patch.active_vault)),
                )
            try:
                async with active_vault_handoff():
                    try:
                        vm.set_active_vault(patch.active_vault)
                    except VaultNotFoundError as e:
                        raise HTTPException(status_code=404, detail=str(e)) from e
                    config = GlobalConfig.load(vm.config_path())
                    try:
                        reload_active_vault_runtime(
                            vm,
                            loop=asyncio.get_running_loop(),
                            note_index=index,
                        )
                        service = get_capture_job_service()
                        if service.enabled:
                            await service.activate(
                                vm.active_vault_dir(), config.capture_processing
                            )
                    except Exception as e:
                        try:
                            vm.set_active_vault(old_active)
                            config = GlobalConfig.load(vm.config_path())
                            reload_active_vault_runtime(
                                vm,
                                loop=asyncio.get_running_loop(),
                                note_index=index,
                            )
                            service = get_capture_job_service()
                            if service.enabled:
                                await service.activate(
                                    vm.active_vault_dir(), config.capture_processing
                                )
                        except Exception:
                            pass
                        raise HTTPException(
                            status_code=409,
                            detail=f"Could not reload active vault runtime: {e}",
                        ) from e
            except VaultHandoffBusyError as e:
                raise HTTPException(status_code=409, detail=str(e)) from e
    if patch.default_provider is not None:
        config.default_provider = patch.default_provider
    config.save(vm.config_path())
    return config.to_public()

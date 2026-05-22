"""``/api/vault`` — read + create vaults."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict

from api.deps import get_config, write_config
from core.config import LoomConfig
from core.exceptions import VaultExistsError
from core.vault import create_vault, vault_exists
from core.vault_scaffold import is_scaffolded

router = APIRouter(prefix="/api/vault", tags=["vault"])


class VaultInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    path: str
    exists: bool
    scaffolded: bool


class VaultExistsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    exists: bool
    scaffolded: bool


class VaultCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    overwrite: bool = False


@router.get("", response_model=VaultInfo)
async def current_vault(
    config: Annotated[LoomConfig, Depends(get_config)],
) -> VaultInfo:
    root = config.vault_path
    exists = root.exists()
    return VaultInfo(
        name=config.active_vault,
        path=str(root),
        exists=exists,
        scaffolded=exists and is_scaffolded(root),
    )


@router.get("/exists", response_model=VaultExistsResponse)
async def vault_exists_route(
    config: Annotated[LoomConfig, Depends(get_config)],
    name: Annotated[str, Query()],
) -> VaultExistsResponse:
    exists, scaffolded = vault_exists(config.loom_dir, name)
    return VaultExistsResponse(name=name, exists=exists, scaffolded=scaffolded)


@router.post("", response_model=VaultInfo, status_code=status.HTTP_201_CREATED)
async def create_vault_route(
    payload: VaultCreateRequest,
    config: Annotated[LoomConfig, Depends(get_config)],
) -> VaultInfo:
    try:
        path = create_vault(config.loom_dir, payload.name, overwrite=payload.overwrite)
    except VaultExistsError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "name": exc.name,
                "scaffolded": exc.scaffolded,
                "message": str(exc),
            },
        ) from exc

    if config.active_vault != payload.name:
        updated = config.model_copy(deep=True)
        updated.active_vault = payload.name
        write_config(updated)

    return VaultInfo(
        name=payload.name,
        path=str(path),
        exists=True,
        scaffolded=True,
    )

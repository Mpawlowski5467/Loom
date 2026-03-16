"""Vault management API routes."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.exceptions import (
    InvalidVaultNameError,
    VaultExistsError,
    VaultNotFoundError,
)
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/vaults", tags=["vaults"])


# -- Request / Response models ------------------------------------------------


class CreateVaultRequest(BaseModel):
    """Request body for creating a new vault."""

    name: str


class VaultResponse(BaseModel):
    """Single vault info."""

    name: str
    path: str
    is_active: bool


class VaultListResponse(BaseModel):
    """Response for listing all vaults."""

    vaults: list[VaultResponse]
    active: str


class SetActiveRequest(BaseModel):
    """Request body for switching the active vault."""

    name: str


# -- Endpoints ----------------------------------------------------------------


@router.post("", status_code=201)
def create_vault(
    body: CreateVaultRequest,
    vm: VaultManager = Depends(get_vault_manager)  # noqa: B008,
) -> VaultResponse:
    """Initialize a new vault."""
    try:
        path = vm.init_vault(body.name)
    except VaultExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return VaultResponse(name=body.name, path=str(path), is_active=True)


@router.get("")
def list_vaults(
    vm: VaultManager = Depends(get_vault_manager)  # noqa: B008,
) -> VaultListResponse:
    """List all initialized vaults."""
    active = vm.get_active_vault()
    names = vm.list_vaults()
    vaults = [
        VaultResponse(
            name=n,
            path=str(vm.vault_path(n)),
            is_active=(n == active),
        )
        for n in names
    ]
    return VaultListResponse(vaults=vaults, active=active)


@router.get("/active")
def get_active_vault(
    vm: VaultManager = Depends(get_vault_manager)  # noqa: B008,
) -> dict[str, str]:
    """Get the currently active vault name."""
    return {"name": vm.get_active_vault()}


@router.put("/active")
def set_active_vault(
    body: SetActiveRequest,
    vm: VaultManager = Depends(get_vault_manager)  # noqa: B008,
) -> dict[str, str]:
    """Switch the active vault."""
    try:
        vm.set_active_vault(body.name)
    except VaultNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"name": body.name}

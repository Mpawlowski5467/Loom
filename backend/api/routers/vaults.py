"""Vault management API routes."""

from __future__ import annotations

import asyncio
import io
import shutil
import tarfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.runtime import release_active_handles, reload_active_vault_runtime
from core.exceptions import (
    InvalidVaultNameError,
    VaultExistsError,
    VaultNotFoundError,
)
from core.note_index import NoteIndex, get_note_index
from core.platform import reveal_in_explorer
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


class VaultExistsResponse(BaseModel):
    """Whether a vault with the given name has been initialized."""

    name: str
    exists: bool
    scaffolded: bool


class RevealVaultResponse(BaseModel):
    """Result of opening a vault path in the OS file manager."""

    ok: bool
    path: str


class ArchiveVaultResponse(BaseModel):
    """Result of archiving a vault directory."""

    archived_name: str
    archived_path: str
    new_active: str | None


class RenameVaultRequest(BaseModel):
    """Request body for renaming a vault."""

    new_name: str


# -- Endpoints ----------------------------------------------------------------


@router.post("", status_code=201)
def create_vault(
    body: CreateVaultRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008,
) -> VaultResponse:
    """Initialize a new vault."""
    try:
        path = vm.init_vault(body.name)
    except VaultExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return VaultResponse(
        name=body.name,
        path=str(path),
        is_active=vm.get_active_vault() == body.name,
    )


@router.get("")
def list_vaults(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008,
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


@router.get("/exists")
def vault_exists(
    name: str = Query(..., min_length=1),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008,
) -> VaultExistsResponse:
    """Probe whether a named vault is initialized.

    ``scaffolded`` reuses ``vault_exists`` semantics — the directory must
    contain a ``vault.yaml`` for it to count as a real Loom vault.
    """
    exists = vm.vault_exists(name)
    return VaultExistsResponse(name=name, exists=exists, scaffolded=exists)


@router.get("/active")
def get_active_vault(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008,
) -> dict[str, str]:
    """Get the currently active vault name."""
    return {"name": vm.get_active_vault()}


@router.put("/active")
async def set_active_vault(
    body: SetActiveRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008,
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, str]:
    """Switch the active vault."""
    try:
        vm.set_active_vault(body.name)
    except VaultNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
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
    return {"name": body.name}


@router.post("/{name}/reveal", response_model=RevealVaultResponse)
def reveal_vault(
    name: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> RevealVaultResponse:
    """Open a vault folder in the platform file manager."""
    try:
        vm.validate_vault_name(name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if not vm.vault_exists(name):
        raise HTTPException(status_code=404, detail=f"Vault not found: {name}")

    path = vm.vault_path(name)
    try:
        reveal_in_explorer(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return RevealVaultResponse(ok=True, path=str(path))


@router.post("/{name}/archive", response_model=ArchiveVaultResponse)
async def archive_vault(
    name: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> ArchiveVaultResponse:
    """Archive a vault directory and pick a valid active vault."""
    try:
        vm.validate_vault_name(name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if not vm.vault_exists(name):
        raise HTTPException(status_code=404, detail=f"Vault not found: {name}")

    old_active = vm.get_active_vault()
    source = vm.vault_path(name)
    if _should_release_handles(vm, name, old_active, source):
        _release_active_handles()

    archived_path = _archive_path(source)
    shutil.move(str(source), str(archived_path))
    remaining = vm.list_vaults()

    if not remaining:
        vm.init_vault("default")
        new_active = "default"
    elif old_active == name or old_active not in remaining:
        new_active = remaining[0]
        vm.set_active_vault(new_active)
    else:
        new_active = old_active

    if new_active != old_active or old_active == name:
        _reload_runtime(vm, index)

    return ArchiveVaultResponse(
        archived_name=archived_path.name,
        archived_path=str(archived_path),
        new_active=new_active,
    )


@router.delete("/{name}", status_code=204)
async def delete_vault(
    name: str,
    hard: bool = Query(False, description="If true, permanently delete the vault"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> None:
    """Permanently delete a vault directory.

    Only honored when ``hard=true``. Soft-delete (archive) is exposed via
    ``POST /api/vaults/{name}/archive`` instead.
    """
    if not hard:
        raise HTTPException(
            status_code=400,
            detail="Pass ?hard=true to permanently delete. Use the archive endpoint for soft delete.",
        )
    try:
        vm.validate_vault_name(name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if not vm.vault_exists(name):
        raise HTTPException(status_code=404, detail=f"Vault not found: {name}")

    old_active = vm.get_active_vault()
    source = vm.vault_path(name)
    if _should_release_handles(vm, name, old_active, source):
        _release_active_handles()

    shutil.rmtree(source)

    remaining = vm.list_vaults()
    if not remaining:
        vm.init_vault("default")
        _reload_runtime(vm, index)
    elif old_active == name or old_active not in remaining:
        vm.set_active_vault(remaining[0])
        _reload_runtime(vm, index)
    return None


@router.get("/{name}/export")
def export_vault(
    name: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> StreamingResponse:
    """Stream a restorable tarball of user-owned vault content."""
    try:
        vm.validate_vault_name(name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if not vm.vault_exists(name):
        raise HTTPException(status_code=404, detail=f"Vault not found: {name}")

    source = vm.vault_path(name)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        vault_yaml = source / "vault.yaml"
        if vault_yaml.exists():
            tar.add(vault_yaml, arcname=f"{name}/vault.yaml")
        for sub in ("threads", "agents", "rules", "prompts"):
            src = source / sub
            if src.exists():
                tar.add(src, arcname=f"{name}/{sub}")
        changelog = source / ".loom" / "changelog"
        if changelog.exists():
            tar.add(changelog, arcname=f"{name}/.loom/changelog")
    buffer.seek(0)

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    filename = f"{name}-export-{stamp}.tar.gz"
    return StreamingResponse(
        buffer,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/{name}", response_model=VaultResponse)
async def rename_vault(
    name: str,
    body: RenameVaultRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> VaultResponse:
    """Rename a vault folder; update active-vault config if needed."""
    try:
        vm.validate_vault_name(name)
        vm.validate_vault_name(body.new_name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if not vm.vault_exists(name):
        raise HTTPException(status_code=404, detail=f"Vault not found: {name}")
    if vm.vault_exists(body.new_name):
        raise HTTPException(
            status_code=409,
            detail=f"Vault '{body.new_name}' already exists",
        )

    old_active = vm.get_active_vault()
    source = vm.vault_path(name)
    if _should_release_handles(vm, name, old_active, source):
        _release_active_handles()

    dst = vm.vault_path(body.new_name)
    shutil.move(str(source), str(dst))

    if old_active == name:
        vm.set_active_vault(body.new_name)
        _reload_runtime(vm, index)
        is_active = True
    else:
        is_active = False

    return VaultResponse(name=body.new_name, path=str(dst), is_active=is_active)


def _should_release_handles(
    vm: VaultManager,
    name: str,
    active: str,
    source: Path,
) -> bool:
    if name == active:
        return True
    try:
        return source.resolve() == vm.vault_path(active).resolve()
    except OSError:
        return False


def _release_active_handles() -> None:
    try:
        release_active_handles()
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail=f"Could not release active vault handles: {exc}",
        ) from exc


def _reload_runtime(vm: VaultManager, index: NoteIndex) -> None:
    try:
        reload_active_vault_runtime(
            vm,
            loop=asyncio.get_running_loop(),
            note_index=index,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail=f"Could not reload active vault runtime: {exc}",
        ) from exc


def _archive_path(source: Path) -> Path:
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ")
    candidate = source.with_name(f"{source.name}.archived-{stamp}")
    index = 1
    while candidate.exists():
        candidate = source.with_name(f"{source.name}.archived-{stamp}-{index}")
        index += 1
    return candidate

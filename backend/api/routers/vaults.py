"""Vault management API routes."""

from __future__ import annotations

import asyncio
import io
import shutil
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
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
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, VaultPathError, get_vault_manager

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
@limiter.limit(WRITE_LIMIT)
def create_vault(
    request: Request,  # noqa: ARG001 — required by slowapi
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

    The name is validated before any filesystem probe so this route cannot be
    used as an existence oracle for arbitrary ``<name>/vault.yaml`` paths.
    """
    try:
        vm.validate_vault_name(name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
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
        # ``reload_active_vault_runtime`` rebinds the file watcher and index to
        # the running loop, so it must execute on the loop (it takes the loop as
        # an argument) — it is intentionally not offloaded to a worker thread.
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
@limiter.limit(WRITE_LIMIT)
async def archive_vault(
    request: Request,  # noqa: ARG001 — required by slowapi
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
    await asyncio.to_thread(shutil.move, str(source), str(archived_path))
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
@limiter.limit(WRITE_LIMIT)
async def delete_vault(
    request: Request,  # noqa: ARG001 — required by slowapi
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

    await asyncio.to_thread(shutil.rmtree, source)

    remaining = vm.list_vaults()
    if not remaining:
        vm.init_vault("default")
        _reload_runtime(vm, index)
    elif old_active == name or old_active not in remaining:
        vm.set_active_vault(remaining[0])
        _reload_runtime(vm, index)
    return None


@router.get("/{name}/export")
@limiter.limit(WRITE_LIMIT)
def export_vault(
    request: Request,  # noqa: ARG001 — required by slowapi
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


@router.post("/{name}/import", response_model=VaultResponse, status_code=201)
@limiter.limit(WRITE_LIMIT)
async def import_vault(
    request: Request,
    name: str,
    overwrite: bool = Query(False, description="Replace an existing non-empty vault"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> VaultResponse:
    """Restore a vault from an uploaded export tarball.

    The ``.tar.gz`` archive is sent as the raw request body (rather than a
    multipart upload, to avoid a ``python-multipart`` dependency). It is
    extracted with the ``data`` filter (rejecting absolute paths, traversal
    members, links, and devices) and every member is additionally asserted to
    land inside the destination vault directory. Refuses to clobber an existing
    non-empty vault unless ``?overwrite=true`` is passed.

    Args:
        request: Incoming request; its body is the gzipped tarball.
        name: Destination vault name to restore into.
        overwrite: When ``True``, replace an existing vault of this name.
        vm: Injected vault manager.

    Returns:
        Metadata for the restored vault.

    Raises:
        HTTPException: 422 on an invalid name, 400 on an empty/malformed or
            traversal-laden tarball, 409 if the vault exists and ``overwrite``
            is not set.
    """
    try:
        vm.validate_vault_name(name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if vm.vault_exists(name) and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"Vault '{name}' already exists. Pass ?overwrite=true to replace it.",
        )

    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty request body; expected a tarball")
    dest = vm.vault_path(name)
    vaults_dir = vm._settings.vaults_dir
    try:
        await asyncio.to_thread(_restore_tarball, payload, dest, vaults_dir)
    except VaultPathError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except tarfile.TarError as e:
        raise HTTPException(status_code=400, detail=f"Invalid tarball: {e}") from e

    return VaultResponse(
        name=name,
        path=str(dest),
        is_active=vm.get_active_vault() == name,
    )


@router.patch("/{name}", response_model=VaultResponse)
@limiter.limit(WRITE_LIMIT)
async def rename_vault(
    request: Request,  # noqa: ARG001 — required by slowapi
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
    await asyncio.to_thread(shutil.move, str(source), str(dst))

    if old_active == name:
        vm.set_active_vault(body.new_name)
        _reload_runtime(vm, index)
        is_active = True
    else:
        is_active = False

    return VaultResponse(name=body.new_name, path=str(dst), is_active=is_active)


def _restore_tarball(payload: bytes, dest: Path, vaults_dir: Path) -> None:
    """Extract an export tarball into ``dest`` safely (path-traversal proof).

    Extraction happens in a temporary staging directory using the ``data``
    filter (Python 3.12+), which rejects absolute paths, ``..`` traversal,
    symlinks/hardlinks escaping the tree, and device nodes. Every extracted
    member is then re-validated to live under the staging dir before the
    restored tree is moved into ``dest`` (always inside ``vaults_dir``).

    Args:
        payload: Raw bytes of the uploaded ``.tar.gz`` archive.
        dest: Target vault directory to populate.
        vaults_dir: Root vaults directory the destination must stay within.

    Raises:
        VaultPathError: If a member escapes the staging dir or the tar has no
            usable top-level vault directory, or ``dest`` escapes ``vaults_dir``.
        tarfile.TarError: If the archive is malformed.
    """
    dest = dest.resolve()
    vaults_root = vaults_dir.resolve()
    if vaults_root not in dest.parents and dest != vaults_root:
        raise VaultPathError("Destination escapes the vaults directory")

    vaults_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=vaults_root, prefix=".import-") as tmp:
        staging = Path(tmp)
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as tar:
            tar.extractall(path=staging, filter="data")
        _assert_within(staging)

        roots = [c for c in staging.iterdir() if c.is_dir()]
        if not roots:
            raise VaultPathError("Tarball contains no vault directory")
        restored = roots[0]

        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(restored), str(dest))


def _assert_within(root: Path) -> None:
    """Raise ``VaultPathError`` if any path under ``root`` escapes ``root``."""
    root = root.resolve()
    for path in root.rglob("*"):
        try:
            path.resolve().relative_to(root)
        except ValueError as exc:
            raise VaultPathError("Tarball member escapes extraction directory") from exc


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

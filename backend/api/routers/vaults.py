"""Vault management API routes."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
import tarfile
import tempfile
import threading
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from api.runtime import release_active_handles, reload_active_vault_runtime
from core.capture_jobs import get_capture_job_service
from core.config import GlobalConfig
from core.exceptions import (
    InvalidVaultNameError,
    VaultExistsError,
    VaultNotFoundError,
)
from core.note_index import NoteIndex, get_note_index
from core.platform import reveal_in_explorer
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, VaultPathError, get_vault_manager
from core.vault_handoff import (
    VaultHandoffBusyError,
    administrative_vault_handoff,
)

router = APIRouter(prefix="/api/vaults", tags=["vaults"])
logger = logging.getLogger(__name__)

# Import archives are first spooled to disk so request size, compressed size,
# and expanded size are all bounded without holding a user's vault in memory.
# Constants are module-level both for clear operational policy and focused tests.
_MAX_IMPORT_ARCHIVE_BYTES = 256 * 1024 * 1024
_MAX_IMPORT_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
_MAX_IMPORT_MEMBERS = 50_000

# Directory swaps are serialized in-process. Hidden deterministic ready/backup
# paths also let startup repair the only two crash windows in an overwrite.
_IMPORT_SWAP_LOCK = threading.Lock()
_IMPORT_READY_SUFFIX = ".import-ready"
_IMPORT_BACKUP_SUFFIX = ".import-backup"


class VaultImportLimitError(VaultPathError):
    """Raised when an archive exceeds a compressed or expanded safety bound."""


class VaultImportConflictError(VaultPathError):
    """Raised when a concurrent import populated a non-overwrite destination."""


class VaultImportRollbackError(RuntimeError):
    """Raised when an old vault backup could not be put back immediately."""


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
    old_active = vm.get_active_vault()
    if body.name == old_active:
        return {"name": body.name}
    if not vm.vault_exists(body.name):
        raise HTTPException(status_code=404, detail=f"Vault '{body.name}' not found")
    async with _vault_handoff():
        try:
            vm.set_active_vault(body.name)
        except VaultNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        try:
            # ``reload_active_vault_runtime`` rebinds the file watcher and index to
            # the running loop, so it must execute on the loop (it takes the loop as
            # an argument) — it is intentionally not offloaded to a worker thread.
            await _reload_runtime(vm, index)
        except Exception as e:
            # Config switched before runtime initialization. Restore both config and
            # worker/index bindings so a failed target cannot strand the old vault.
            try:
                vm.set_active_vault(old_active)
                await _reload_runtime(vm, index)
            except Exception:
                pass
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
    active_handoff = _should_release_handles(vm, name, old_active, source)
    async with _vault_handoff(active_handoff):
        if active_handoff:
            _release_active_handles()

        archived_path = _archive_path(source)
        try:
            await asyncio.to_thread(shutil.move, str(source), str(archived_path))
        except Exception:
            if source.exists() and old_active == name:
                await _reload_runtime(vm, index)
            raise
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
            await _reload_runtime(vm, index)

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
    active_handoff = _should_release_handles(vm, name, old_active, source)
    async with _vault_handoff(active_handoff):
        if active_handoff:
            _release_active_handles()

        try:
            await asyncio.to_thread(shutil.rmtree, source)
        except Exception:
            if source.exists() and old_active == name:
                await _reload_runtime(vm, index)
            raise

        remaining = vm.list_vaults()
        if not remaining:
            vm.init_vault("default")
            await _reload_runtime(vm, index)
        elif old_active == name or old_active not in remaining:
            vm.set_active_vault(remaining[0])
            await _reload_runtime(vm, index)
        return None


@router.get("/{name}/export")
@limiter.limit(WRITE_LIMIT)
def export_vault(
    request: Request,  # noqa: ARG001 — required by slowapi
    name: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> FileResponse:
    """Stream a restorable tarball without buffering the vault in memory."""
    try:
        vm.validate_vault_name(name)
    except InvalidVaultNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if not vm.vault_exists(name):
        raise HTTPException(status_code=404, detail=f"Vault not found: {name}")

    source = vm.vault_path(name)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    filename = f"{name}-export-{stamp}.tar.gz"
    archive_path = _build_export_archive(source, name, vm._settings.loom_home)
    return FileResponse(
        archive_path,
        media_type="application/gzip",
        filename=filename,
        background=BackgroundTask(_safe_unlink, archive_path),
    )


@router.post("/{name}/import", response_model=VaultResponse, status_code=201)
@limiter.limit(WRITE_LIMIT)
async def import_vault(
    request: Request,
    name: str,
    overwrite: bool = Query(False, description="Replace an existing non-empty vault"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
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
    dest = vm.vault_path(name)
    if _destination_has_content(dest) and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"Vault '{name}' already exists. Pass ?overwrite=true to replace it.",
        )

    vaults_dir = vm._settings.vaults_dir
    archive_path = await _spool_import_archive(request, vm._settings.loom_home)
    is_active = vm.get_active_vault() == name
    try:
        async with _vault_handoff(is_active):
            if is_active:
                _release_active_handles()
            try:
                await asyncio.to_thread(
                    _restore_tarball,
                    archive_path,
                    dest,
                    vaults_dir,
                    overwrite=overwrite,
                )
            except VaultImportLimitError as exc:
                await _restore_runtime_after_failed_import(is_active, dest, vm, index)
                raise HTTPException(status_code=413, detail=str(exc)) from exc
            except VaultImportConflictError as exc:
                await _restore_runtime_after_failed_import(is_active, dest, vm, index)
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            except VaultPathError as exc:
                await _restore_runtime_after_failed_import(is_active, dest, vm, index)
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except tarfile.TarError as exc:
                await _restore_runtime_after_failed_import(is_active, dest, vm, index)
                raise HTTPException(status_code=400, detail=f"Invalid tarball: {exc}") from exc
            except VaultImportRollbackError as exc:
                await _restore_runtime_after_failed_import(is_active, dest, vm, index)
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            except Exception as exc:
                await _restore_runtime_after_failed_import(is_active, dest, vm, index)
                raise HTTPException(
                    status_code=500,
                    detail="Vault import failed; the previous vault was restored",
                ) from exc

            if is_active:
                await _reload_runtime(vm, index)
    finally:
        _safe_unlink(archive_path)

    return VaultResponse(
        name=name,
        path=str(dest),
        is_active=is_active,
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
    active_handoff = _should_release_handles(vm, name, old_active, source)
    async with _vault_handoff(active_handoff):
        if active_handoff:
            _release_active_handles()

        dst = vm.vault_path(body.new_name)
        try:
            await asyncio.to_thread(shutil.move, str(source), str(dst))
        except Exception:
            if source.exists() and old_active == name:
                await _reload_runtime(vm, index)
            raise

        if old_active == name:
            vm.set_active_vault(body.new_name)
            await _reload_runtime(vm, index)
            is_active = True
        else:
            is_active = False

        return VaultResponse(name=body.new_name, path=str(dst), is_active=is_active)


def _build_export_archive(source: Path, name: str, temp_root: Path) -> Path:
    """Create an on-disk export archive and return its temporary path."""
    temp_root.mkdir(parents=True, exist_ok=True)
    fd, raw_path = tempfile.mkstemp(
        dir=temp_root,
        prefix=".loom-export-",
        suffix=".tar.gz",
    )
    os.close(fd)
    archive_path = Path(raw_path)
    try:
        with tarfile.open(archive_path, mode="w:gz") as tar:
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
    except BaseException:
        _safe_unlink(archive_path)
        raise
    return archive_path


def _destination_has_content(dest: Path) -> bool:
    """Return whether an import would replace existing filesystem content."""
    if not dest.exists():
        return False
    if not dest.is_dir():
        return True
    return next(dest.iterdir(), None) is not None


async def _spool_import_archive(request: Request, temp_root: Path) -> Path:
    """Stream an upload to a private temp file under a compressed-size cap."""
    content_length = request.headers.get("content-length")
    if content_length:
        with contextlib.suppress(ValueError):
            if int(content_length) > _MAX_IMPORT_ARCHIVE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Import archive exceeds {_MAX_IMPORT_ARCHIVE_BYTES} bytes",
                )

    temp_root.mkdir(parents=True, exist_ok=True)
    fd, raw_path = tempfile.mkstemp(
        dir=temp_root,
        prefix=".loom-import-upload-",
        suffix=".tar.gz",
    )
    archive_path = Path(raw_path)
    total = 0
    try:
        with os.fdopen(fd, "wb") as output:
            async for chunk in request.stream():
                if not chunk:
                    continue
                total += len(chunk)
                if total > _MAX_IMPORT_ARCHIVE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Import archive exceeds {_MAX_IMPORT_ARCHIVE_BYTES} bytes",
                    )
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if total == 0:
            raise HTTPException(status_code=400, detail="Empty request body; expected a tarball")
        return archive_path
    except BaseException:
        # ``fdopen`` owns and closes the descriptor even on an exception.
        _safe_unlink(archive_path)
        raise


def _restore_tarball(
    archive_path: Path,
    dest: Path,
    vaults_dir: Path,
    *,
    overwrite: bool,
) -> None:
    """Validate, durably stage, and transactionally install a vault archive.

    The restored tree is fully extracted and fsynced in a hidden sibling before
    the live destination changes. An overwrite moves the old vault to a hidden
    backup, atomically promotes the ready tree, and restores the backup on any
    exception. Deterministic artifact names allow startup recovery after a
    process or machine crash in either rename window.
    """
    if dest.is_symlink():
        raise VaultPathError("Import destination cannot be a symbolic link")
    dest = dest.resolve()
    vaults_root = vaults_dir.resolve()
    if vaults_root not in dest.parents or dest == vaults_root:
        raise VaultPathError("Destination escapes the vaults directory")

    vaults_root.mkdir(parents=True, exist_ok=True)
    ready = _import_ready_path(dest)
    backup = _import_backup_path(dest)

    with _IMPORT_SWAP_LOCK:
        _recover_one_import(dest, ready, backup)
        # Repeat the route's fast conflict check while holding the swap lock.
        # Otherwise, two simultaneous create-only imports can both observe a
        # missing destination and the later one would silently overwrite the
        # first after waiting here.
        if _destination_has_content(dest) and not overwrite:
            raise VaultImportConflictError(
                f"Vault '{dest.name}' was created by another import; retry with overwrite=true"
            )
        with tempfile.TemporaryDirectory(dir=vaults_root, prefix=".import-stage-") as tmp:
            staging = Path(tmp)
            members = _validated_import_members(archive_path)
            with tarfile.open(archive_path, mode="r:gz") as tar:
                tar.extractall(path=staging, members=members, filter="data")
            _assert_within(staging)

            children = list(staging.iterdir())
            if len(children) != 1 or not children[0].is_dir():
                raise VaultPathError("Tarball must contain exactly one vault directory")
            restored = children[0]
            _validate_restored_vault(restored)
            # Operational queue state belongs to the source runtime, not the
            # user-owned Markdown backup being restored.
            _remove_imported_capture_job_db(restored)
            _fsync_tree(restored)
            _atomic_rename(restored, ready)
            _fsync_dir(vaults_root)

        had_destination = dest.exists()
        try:
            if had_destination:
                _atomic_rename(dest, backup)
                _fsync_dir(vaults_root)
            _atomic_rename(ready, dest)
            _fsync_dir(vaults_root)
        except Exception:
            rollback_error: Exception | None = None
            try:
                if had_destination and backup.exists() and not dest.exists():
                    _atomic_rename(backup, dest)
                    _fsync_dir(vaults_root)
            except Exception as exc:
                rollback_error = exc
            finally:
                if ready.exists():
                    try:
                        _remove_path(ready)
                    except Exception:
                        logger.warning(
                            "Failed to remove aborted import staging %s",
                            ready,
                            exc_info=True,
                        )
            if rollback_error is not None:
                raise VaultImportRollbackError(
                    "Vault import failed and immediate rollback could not complete; "
                    "the previous vault remains in a recovery backup"
                ) from rollback_error
            raise

        if backup.exists():
            try:
                _remove_path(backup)
                _fsync_dir(vaults_root)
            except Exception:
                # The new vault is already committed. Leaving a hidden backup is
                # safer than failing a successful import; startup retries cleanup.
                logger.warning("Failed to remove completed import backup %s", backup, exc_info=True)


def _validated_import_members(archive_path: Path) -> list[tarfile.TarInfo]:
    """Preflight member count/type and expanded bytes before extraction."""
    members: list[tarfile.TarInfo] = []
    expanded_bytes = 0
    with tarfile.open(archive_path, mode="r:gz") as tar:
        for member in tar:
            if len(members) >= _MAX_IMPORT_MEMBERS:
                raise VaultImportLimitError(
                    f"Import archive contains more than {_MAX_IMPORT_MEMBERS} entries"
                )
            if not (member.isfile() or member.isdir()):
                raise VaultPathError(f"Tarball member type is not allowed: {member.name}")
            if member.size < 0:
                raise VaultPathError(f"Tarball member has an invalid size: {member.name}")
            if member.isfile():
                expanded_bytes += member.size
                if expanded_bytes > _MAX_IMPORT_EXPANDED_BYTES:
                    raise VaultImportLimitError(
                        f"Import archive expands beyond {_MAX_IMPORT_EXPANDED_BYTES} bytes"
                    )
            members.append(member)
    if not members:
        raise VaultPathError("Tarball contains no vault files")
    return members


def _validate_restored_vault(restored: Path) -> None:
    """Require the minimum valid Loom-vault shape before the live swap."""
    vault_yaml = restored / "vault.yaml"
    if not vault_yaml.is_file() or vault_yaml.is_symlink():
        raise VaultPathError("Tarball vault is missing vault.yaml")
    try:
        data = yaml.safe_load(vault_yaml.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        raise VaultPathError("Tarball vault.yaml is not valid YAML") from exc
    if not isinstance(data, dict) or not isinstance(data.get("name"), str):
        raise VaultPathError("Tarball vault.yaml must contain a vault name")
    threads = restored / "threads"
    if not threads.is_dir() or threads.is_symlink():
        raise VaultPathError("Tarball vault is missing its threads directory")


def _import_ready_path(dest: Path) -> Path:
    return dest.with_name(f".{dest.name}{_IMPORT_READY_SUFFIX}")


def _import_backup_path(dest: Path) -> Path:
    return dest.with_name(f".{dest.name}{_IMPORT_BACKUP_SUFFIX}")


def _atomic_rename(source: Path, destination: Path) -> None:
    """Rename within the vaults filesystem; isolated for failure testing."""
    source.replace(destination)


def _remove_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _recover_one_import(dest: Path, ready: Path, backup: Path) -> None:
    """Resolve hidden artifacts left by an interrupted directory swap."""
    if ready.is_symlink() or backup.is_symlink():
        raise VaultPathError("Refusing symbolic links in vault import recovery state")
    if backup.exists():
        if ready.exists() and dest.exists():
            raise VaultPathError(f"Ambiguous interrupted import state for vault '{dest.name}'")
        if dest.exists():
            _remove_path(backup)
        else:
            _atomic_rename(backup, dest)
            _fsync_dir(dest.parent)
    if ready.exists():
        _remove_path(ready)


def recover_interrupted_vault_imports(vaults_dir: Path) -> None:
    """Repair all deterministic import artifacts before runtime initialization."""
    if not vaults_dir.exists():
        return
    with _IMPORT_SWAP_LOCK:
        backups = list(vaults_dir.glob(f".*{_IMPORT_BACKUP_SUFFIX}"))
        ready_paths = list(vaults_dir.glob(f".*{_IMPORT_READY_SUFFIX}"))
        names = {path.name[1 : -len(_IMPORT_BACKUP_SUFFIX)] for path in backups} | {
            path.name[1 : -len(_IMPORT_READY_SUFFIX)] for path in ready_paths
        }
        for name in sorted(names):
            if not name:
                continue
            dest = vaults_dir / name
            _recover_one_import(dest, _import_ready_path(dest), _import_backup_path(dest))


def _fsync_tree(root: Path) -> None:
    """Flush staged file content before the directory becomes authoritative."""
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            with path.open("rb") as handle:
                os.fsync(handle.fileno())
        except OSError:
            # Some special filesystems do not support fsync; extraction remains
            # transactional even when the durability hint is unavailable.
            logger.debug("Could not fsync imported file %s", path, exc_info=True)
    for directory in sorted(
        (path for path in root.rglob("*") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        _fsync_dir(directory)
    _fsync_dir(root)


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _safe_unlink(path: Path) -> None:
    with contextlib.suppress(OSError):
        path.unlink(missing_ok=True)


async def _restore_runtime_after_failed_import(
    is_active: bool,
    dest: Path,
    vm: VaultManager,
    index: NoteIndex,
) -> None:
    if not is_active or not dest.exists():
        return
    try:
        await _reload_runtime(vm, index)
    except Exception:
        logger.error("Failed to reactivate vault after import rollback", exc_info=True)


def _assert_within(root: Path) -> None:
    """Raise ``VaultPathError`` if any path under ``root`` escapes ``root``."""
    root = root.resolve()
    for path in root.rglob("*"):
        try:
            path.resolve().relative_to(root)
        except ValueError as exc:
            raise VaultPathError("Tarball member escapes extraction directory") from exc


def _remove_imported_capture_job_db(vault_root: Path) -> None:
    """Never restore queue state whose capture paths/outcomes belong elsewhere."""
    db = vault_root / ".loom" / "capture-jobs.sqlite3"
    for path in (db, Path(f"{db}-wal"), Path(f"{db}-shm")):
        path.unlink(missing_ok=True)


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


@contextlib.asynccontextmanager
async def _vault_handoff(required: bool = True) -> AsyncIterator[None]:
    """Map shared active-vault handoff refusal to the API's 409 contract."""
    try:
        async with administrative_vault_handoff(active=required):
            yield
    except VaultHandoffBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


async def _reload_runtime(vm: VaultManager, index: NoteIndex) -> None:
    try:
        reload_active_vault_runtime(
            vm,
            loop=asyncio.get_running_loop(),
            note_index=index,
        )
        config = GlobalConfig.load(vm.config_path())
        service = get_capture_job_service()
        if service.enabled:
            await service.activate(vm.active_vault_dir(), config.capture_processing)
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

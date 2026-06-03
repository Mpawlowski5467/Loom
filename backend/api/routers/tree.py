"""File tree API route."""

import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from core.note_index import NoteIndex, get_note_index
from core.notes import parse_note_meta
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/tree", tags=["tree"])

# Bare name (no slashes, no dots) — used for folder names and the
# ``new_name`` payload of rename.
_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# A path component: either a bare name, or ``<bare>.md`` for note files.
# Bare names cannot start with a dot (rules out hidden dirs) and cannot
# be ``..``.
_COMPONENT_RE = re.compile(r"^[A-Za-z0-9_-]+(?:\.md)?$")

# Core folders that must not be renamed/deleted (see CLAUDE.md). Kept here
# so G3 can reuse it.
RESERVED_FOLDERS = frozenset({"daily", "projects", "topics", "people", "captures"})


def _resolve_safe_subpath(threads_root: Path, rel: str) -> Path:
    """Resolve ``rel`` under ``threads_root``, refusing traversal.

    Each path component must match ``_COMPONENT_RE`` — this blocks
    ``..``, leading dots, absolute paths, and unusual characters in one
    shot. Components ending in ``.md`` are accepted (note files).
    Returns the resolved Path (which may not exist yet).
    """
    if not rel or rel.strip() != rel:
        raise HTTPException(status_code=400, detail="Path is empty")
    if rel.startswith("/") or rel.startswith("\\"):
        raise HTTPException(status_code=400, detail="Absolute paths not allowed")

    parts = rel.replace("\\", "/").split("/")
    for part in parts:
        if not _COMPONENT_RE.match(part):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid path component '{part}': use letters, digits, "
                    "dashes, or underscores (optionally with a .md suffix)"
                ),
            )

    threads_root_resolved = threads_root.resolve()
    candidate = (threads_root_resolved / Path(*parts)).resolve()
    try:
        candidate.relative_to(threads_root_resolved)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Path escapes the vault") from exc
    return candidate


class TreeNode(BaseModel):
    """A single node in the file tree (file or directory)."""

    name: str
    path: str
    is_dir: bool
    note_id: str = ""
    note_type: str = ""
    tag_count: int = 0
    modified: str = ""
    children: list["TreeNode"] = Field(default_factory=list)


def _build_tree(dir_path: Path, threads_root: Path) -> TreeNode:
    """Recursively build a TreeNode from a directory."""
    children: list[TreeNode] = []

    if dir_path.is_dir():
        for child in sorted(dir_path.iterdir()):
            if child.name.startswith(".") and child.name != ".archive":
                continue
            children.append(_build_tree(child, threads_root))

    rel = str(dir_path.relative_to(threads_root))
    node = TreeNode(
        name=dir_path.name,
        path=rel,
        is_dir=dir_path.is_dir(),
        children=children,
    )

    if dir_path.is_file() and dir_path.suffix == ".md":
        try:
            meta = parse_note_meta(dir_path)
            node.note_id = meta.id
            node.note_type = meta.type
            node.tag_count = len(meta.tags)
            node.modified = meta.modified
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            stat = dir_path.stat()
            node.modified = datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(
                timespec="seconds"
            )

    return node


@router.get("")
def get_tree(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> TreeNode:
    """Return the full file tree of the active vault's threads/ folder."""
    tdir = vm.active_threads_dir()
    if not tdir.exists():
        return TreeNode(name="threads", path=".", is_dir=True)
    return _build_tree(tdir, tdir)


class CreateFolderRequest(BaseModel):
    """Request body for creating a folder under ``threads/``."""

    path: str


@router.post("/folder", status_code=201)
@limiter.limit(WRITE_LIMIT)
def create_folder(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: CreateFolderRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> TreeNode:
    """Create a folder under the active vault's ``threads/`` directory.

    Accepts a relative path like ``research`` or ``topics/sub``. Path
    components are validated against ``_NAME_RE`` — any traversal,
    absolute path, or hidden name is rejected with 400.
    """
    tdir = vm.active_threads_dir()
    tdir.mkdir(parents=True, exist_ok=True)
    target = _resolve_safe_subpath(tdir, body.path)
    if target.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")
    target.mkdir(parents=True, exist_ok=False)
    return _build_tree(target, tdir)


class MoveRequest(BaseModel):
    """Request body for moving a file or folder inside ``threads/``."""

    from_: str = Field(alias="from")
    to: str

    model_config = {"populate_by_name": True}


@router.post("/move")
@limiter.limit(WRITE_LIMIT)
def move_path(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: MoveRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> TreeNode:
    """Move a file or folder under ``threads/`` to a new location.

    Both source and destination must resolve inside the active vault's
    threads directory. Destination must not already exist (409).
    """
    tdir = vm.active_threads_dir()
    src = _resolve_safe_subpath(tdir, body.from_)
    dst = _resolve_safe_subpath(tdir, body.to)

    if not src.exists():
        raise HTTPException(status_code=404, detail="Source not found")
    if dst.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")

    # Snapshot pre-move .md paths under src so we can clear the index
    # cleanly. After shutil.move, src no longer exists.
    pre_move_md = _walk_md(src) if src.is_dir() else []

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))

    if dst.is_file() and dst.suffix == ".md":
        index.remove_file(src)
        index.refresh_file(dst)
    elif dst.is_dir():
        for old_path in pre_move_md:
            index.remove_file(old_path)
        for new_path in _walk_md(dst):
            index.refresh_file(new_path)

    return _build_tree(dst, tdir)


def _walk_md(root: Path) -> list[Path]:
    """Return every ``.md`` file under ``root`` (only used for index sync)."""
    if not root.exists():
        return []
    return [p for p in root.rglob("*.md") if p.is_file()]


class RenameRequest(BaseModel):
    """Request body for renaming a file/folder within its current parent."""

    path: str
    new_name: str


@router.patch("/rename")
@limiter.limit(WRITE_LIMIT)
def rename_path(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: RenameRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> TreeNode:
    """Rename a file or folder within its current parent directory.

    For files the suffix is preserved (``.md``). For folders, core
    folders listed in ``RESERVED_FOLDERS`` cannot be renamed.
    """
    tdir = vm.active_threads_dir()
    src = _resolve_safe_subpath(tdir, body.path)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    if not _NAME_RE.match(body.new_name):
        raise HTTPException(
            status_code=400,
            detail=("Invalid name: use letters, digits, dashes, or underscores only"),
        )

    if src.is_dir() and src.name in RESERVED_FOLDERS and src.parent == tdir:
        raise HTTPException(status_code=400, detail=f"Cannot rename core folder '{src.name}'")

    new_name = body.new_name + (src.suffix if src.is_file() else "")
    dst = src.parent / new_name
    if dst.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")

    pre_move_md = _walk_md(src) if src.is_dir() else []
    src.rename(dst)

    if dst.is_file() and dst.suffix == ".md":
        index.remove_file(src)
        index.refresh_file(dst)
    elif dst.is_dir():
        for old_path in pre_move_md:
            index.remove_file(old_path)
        for new_path in _walk_md(dst):
            index.refresh_file(new_path)

    return _build_tree(dst, tdir)


@router.delete("/path/{rel_path:path}")
@limiter.limit(WRITE_LIMIT)
def archive_path(
    request: Request,  # noqa: ARG001 — required by slowapi
    rel_path: str,
    hard: bool = False,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, str]:
    """Archive (default) or hard-delete a file or folder under ``threads/``.

    Archive moves to ``threads/.archive/<original-path>``. Hard delete
    removes the file or folder permanently (``?hard=true``). Core
    folders cannot be archived or deleted.
    """
    tdir = vm.active_threads_dir()
    src = _resolve_safe_subpath(tdir, rel_path)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if src == tdir:
        raise HTTPException(status_code=400, detail="Cannot remove threads root")
    if src.is_dir() and src.name in RESERVED_FOLDERS and src.parent == tdir:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot remove core folder '{src.name}'",
        )

    pre_move_md = _walk_md(src) if src.is_dir() else []

    if hard:
        if src.is_dir():
            shutil.rmtree(src)
        else:
            src.unlink()
        for old_path in pre_move_md or ([src] if src.suffix == ".md" else []):
            index.remove_file(old_path)
        return {"status": "deleted", "path": str(src)}

    archive_root = tdir / ".archive"
    archive_root.mkdir(parents=True, exist_ok=True)
    dst = archive_root / src.relative_to(tdir)
    if dst.exists():
        ts = datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%S")
        dst = dst.with_name(f"{dst.name}-{ts}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))

    if src.suffix == ".md":
        index.remove_file(src)
    for old_path in pre_move_md:
        index.remove_file(old_path)

    return {"status": "archived", "path": str(dst)}

"""File tree API route."""

from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.notes import parse_note_meta
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/tree", tags=["tree"])


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
        except Exception:  # noqa: BLE001
            stat = dir_path.stat()
            node.modified = datetime.fromtimestamp(
                stat.st_mtime, tz=UTC
            ).isoformat(timespec="seconds")

    return node


@router.get("")
async def get_tree(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> TreeNode:
    """Return the full file tree of the active vault's threads/ folder."""
    tdir = vm.active_threads_dir()
    if not tdir.exists():
        return TreeNode(name="threads", path=".", is_dir=True)
    return _build_tree(tdir, tdir)

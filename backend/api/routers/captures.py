"""Captures inbox API route."""

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.notes import parse_note
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/captures", tags=["captures"])


class CaptureItem(BaseModel):
    """A capture file with metadata and preview."""

    id: str = ""
    title: str = ""
    type: str = "capture"
    tags: list[str] = Field(default_factory=list)
    created: str = ""
    modified: str = ""
    author: str = ""
    source: str = ""
    status: str = "active"
    preview: str = ""
    file_path: str = ""


def _extract_preview(body: str, max_lines: int = 2) -> str:
    """Extract the first non-empty lines as a preview."""
    lines = [ln for ln in body.strip().splitlines() if ln.strip()]
    return "\n".join(lines[:max_lines])


def _list_captures(captures_dir: Path) -> list[CaptureItem]:
    """List all markdown files in captures/ with metadata and preview."""
    items: list[CaptureItem] = []
    if not captures_dir.exists():
        return items

    for md_file in sorted(captures_dir.glob("*.md"), reverse=True):
        try:
            note = parse_note(md_file)
            items.append(
                CaptureItem(
                    id=note.id,
                    title=note.title,
                    type=note.type,
                    tags=note.tags,
                    created=note.created,
                    modified=note.modified,
                    author=note.author,
                    source=note.source,
                    status=note.status,
                    preview=_extract_preview(note.body),
                    file_path=note.file_path,
                )
            )
        except Exception:  # noqa: BLE001
            continue

    return items


@router.get("")
def get_captures(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[CaptureItem]:
    """Return all capture files with metadata and preview text."""
    captures_dir = vm.active_threads_dir() / "captures"
    return _list_captures(captures_dir)

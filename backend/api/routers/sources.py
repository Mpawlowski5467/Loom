"""Read the original capture behind a published note, including archived sources."""

from fastapi import APIRouter, Depends, HTTPException, Request
from yaml import YAMLError

from core.note_index import NoteIndex, get_note_index
from core.notes import Note, parse_note
from core.rate_limit import READ_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/sources", tags=["sources"])


@router.get("/{note_id}", response_model=Note)
@limiter.limit(READ_LIMIT)
def original_capture(
    request: Request,  # noqa: ARG001
    note_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Note:
    path = index.get_path_by_id(note_id)
    if path is None:
        raise HTTPException(404, "Note not found")
    note = parse_note(path)
    if not note.source.startswith("capture:"):
        raise HTTPException(404, "This note has no original capture")
    capture_id = note.source.removeprefix("capture:")
    root = vm.active_threads_dir().resolve()
    for directory in (root / "captures", root / ".archive"):
        if directory.is_symlink() or not directory.exists():
            continue
        for candidate in directory.rglob("*.md"):
            if candidate.is_symlink() or not candidate.resolve().is_relative_to(root):
                continue
            try:
                source = parse_note(candidate)
            except (OSError, ValueError, YAMLError):
                continue
            if source.id == capture_id and source.type == "capture":
                return source
    raise HTTPException(404, "The original capture could not be found in this vault or its archive")

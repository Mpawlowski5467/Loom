"""Notes CRUD API routes."""

import shutil

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core.note_index import NoteIndex, get_note_index
from core.notes import (
    Note,
    NoteMeta,
    atomic_write_text,
    generate_id,
    note_to_file_content,
    now_iso,
    parse_note,
)
from core.notes_helpers import TYPE_TO_FOLDER, to_kebab
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/notes", tags=["notes"])

# -- Request / Response models ------------------------------------------------


class CreateNoteRequest(BaseModel):
    """Request body for creating a new note."""

    title: str
    type: str = "topic"
    tags: list[str] = Field(default_factory=list)
    folder: str = ""
    content: str = ""


class UpdateNoteRequest(BaseModel):
    """Request body for updating a note."""

    body: str | None = None
    tags: list[str] | None = None
    type: str | None = None


class NoteListResponse(BaseModel):
    """Paginated list of note metadata."""

    notes: list[NoteMeta]
    total: int
    offset: int
    limit: int


# -- Endpoints ----------------------------------------------------------------


@router.get("")
@limiter.limit(READ_LIMIT)
def list_notes(
    request: Request,  # noqa: ARG001 — required by slowapi
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> NoteListResponse:
    """List all notes (frontmatter only) with pagination."""
    all_metas = sorted(index.all_metas(), key=lambda m: m.title.lower())
    total = len(all_metas)
    page = all_metas[offset : offset + limit]
    return NoteListResponse(notes=page, total=total, offset=offset, limit=limit)


@router.get("/{note_id}")
@limiter.limit(READ_LIMIT)
def get_note(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str,
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Note:
    """Get a full note by id."""
    path = index.get_path_by_id(note_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return parse_note(path)


@router.post("", status_code=201)
@limiter.limit(WRITE_LIMIT)
async def create_note(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: CreateNoteRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Note:
    """Create a new note via Weaver agent (or direct write as fallback)."""
    from agents.loom.weaver import get_weaver

    folder = body.folder or TYPE_TO_FOLDER.get(body.type, "topics")

    weaver = get_weaver()
    if weaver is not None:
        try:
            note = await weaver.create_from_modal(
                title=body.title,
                note_type=body.type,
                tags=body.tags,
                folder=folder,
                content=body.content,
            )
            # Eagerly update the index
            from pathlib import Path

            index.refresh_file(Path(note.file_path))
            return note
        except Exception:  # noqa: BLE001
            pass  # Fall through to direct creation

    # Direct creation fallback (no Weaver or Weaver failed)
    tdir = vm.active_threads_dir()
    target_dir = tdir / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    note_id = generate_id()
    ts = now_iso()
    stem = to_kebab(body.title) or note_id

    meta = {
        "id": note_id,
        "title": body.title,
        "type": body.type,
        "tags": body.tags,
        "created": ts,
        "modified": ts,
        "author": "user",
        "source": "manual",
        "links": [],
        "status": "active",
        "history": [
            {"action": "created", "by": "user", "at": ts, "reason": "Initial creation"},
        ],
    }

    file_path = target_dir / f"{stem}.md"
    atomic_write_text(file_path, note_to_file_content(meta, body.content))

    # Eagerly update the index so the new note is immediately findable
    index.refresh_file(file_path)

    return parse_note(file_path)


@router.put("/{note_id}")
@limiter.limit(WRITE_LIMIT)
def update_note(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str,
    body: UpdateNoteRequest,
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Note:
    """Update a note's body, tags, or type."""
    path = index.get_path_by_id(note_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")

    note = parse_note(path)
    ts = now_iso()

    # Build updated meta dict from current note
    meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["modified"] = ts

    if body.tags is not None:
        meta["tags"] = body.tags
    if body.type is not None:
        meta["type"] = body.type

    meta["history"].append(
        {"action": "edited", "by": "user", "at": ts, "reason": "Updated via API"},
    )

    new_body = body.body if body.body is not None else note.body
    atomic_write_text(path, note_to_file_content(meta, new_body))

    # Update index with new metadata
    index.refresh_file(path)

    return parse_note(path)


@router.delete("/{note_id}")
@limiter.limit(WRITE_LIMIT)
def archive_note(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, str]:
    """Archive a note by moving it to .archive/."""
    tdir = vm.active_threads_dir()
    path = index.get_path_by_id(note_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")

    archive_dir = tdir / ".archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    # Update frontmatter before moving
    note = parse_note(path)
    ts = now_iso()
    meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["status"] = "archived"
    meta["modified"] = ts
    meta["history"].append(
        {"action": "archived", "by": "user", "at": ts, "reason": "Archived via API"},
    )
    atomic_write_text(path, note_to_file_content(meta, note.body))

    dest = archive_dir / path.name
    if dest.exists():
        # Collision: prior archive of a note with the same filename.
        # Suffix with the archival timestamp (filesystem-safe) to keep both.
        safe_ts = ts.replace(":", "-")
        dest = dest.with_stem(f"{dest.stem}-{safe_ts}")
    shutil.move(str(path), str(dest))

    # Remove from index (archived notes are excluded)
    index.remove_file(path)

    return {"status": "archived", "path": str(dest)}

"""Notes CRUD API routes."""

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.notes import (
    Note,
    NoteMeta,
    generate_id,
    note_to_file_content,
    now_iso,
    parse_note,
    parse_note_meta,
)
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


# -- Helpers ------------------------------------------------------------------

_TYPE_TO_FOLDER = {
    "daily": "daily",
    "project": "projects",
    "topic": "topics",
    "person": "people",
    "capture": "captures",
}


def _find_note_path(note_id: str, tdir: Path) -> Path | None:
    """Find the .md file for a given note id by scanning threads/."""
    if not tdir.exists():
        return None
    for md in tdir.rglob("*.md"):
        if ".archive" in md.parts:
            continue
        try:
            text = md.read_text(encoding="utf-8")
        except OSError:
            continue
        # Quick check before full parse
        if note_id in text[:500]:
            note = parse_note(md)
            if note.id == note_id:
                return md
    return None


def _to_kebab(title: str) -> str:
    """Convert a title to a kebab-case filename stem."""
    cleaned = "".join(c if c.isalnum() or c in " -_" else "" for c in title)
    return "-".join(cleaned.lower().split())[:60]


# -- Endpoints ----------------------------------------------------------------


@router.get("")
async def list_notes(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> NoteListResponse:
    """List all notes (frontmatter only) with pagination."""
    tdir = vm.active_threads_dir()
    if not tdir.exists():
        return NoteListResponse(notes=[], total=0, offset=offset, limit=limit)

    all_metas: list[NoteMeta] = []
    for md in sorted(tdir.rglob("*.md")):
        if ".archive" in md.parts:
            continue
        try:
            all_metas.append(parse_note_meta(md))
        except Exception:  # noqa: BLE001
            continue

    total = len(all_metas)
    page = all_metas[offset : offset + limit]
    return NoteListResponse(notes=page, total=total, offset=offset, limit=limit)


@router.get("/{note_id}")
async def get_note(
    note_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> Note:
    """Get a full note by id."""
    path = _find_note_path(note_id, vm.active_threads_dir())
    if path is None:
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return parse_note(path)


@router.post("", status_code=201)
async def create_note(
    body: CreateNoteRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> Note:
    """Create a new note with generated id and frontmatter."""
    tdir = vm.active_threads_dir()
    folder = body.folder or _TYPE_TO_FOLDER.get(body.type, "topics")
    target_dir = tdir / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    note_id = generate_id()
    ts = now_iso()
    stem = _to_kebab(body.title) or note_id

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
    file_path.write_text(note_to_file_content(meta, body.content), encoding="utf-8")
    return parse_note(file_path)


@router.put("/{note_id}")
async def update_note(
    note_id: str,
    body: UpdateNoteRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> Note:
    """Update a note's body, tags, or type."""
    path = _find_note_path(note_id, vm.active_threads_dir())
    if path is None:
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
    path.write_text(note_to_file_content(meta, new_body), encoding="utf-8")
    return parse_note(path)


@router.delete("/{note_id}")
async def archive_note(
    note_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> dict[str, str]:
    """Archive a note by moving it to .archive/."""
    tdir = vm.active_threads_dir()
    path = _find_note_path(note_id, tdir)
    if path is None:
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
    path.write_text(note_to_file_content(meta, note.body), encoding="utf-8")

    dest = archive_dir / path.name
    shutil.move(str(path), str(dest))
    return {"status": "archived", "path": str(dest)}

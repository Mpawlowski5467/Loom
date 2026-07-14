"""Notes CRUD API routes."""

import asyncio
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from agents.file_locks import path_lock
from core.archive_paths import (
    ARCHIVE_ORIGINAL_PATH_FIELD,
    ArchivePathError,
    archive_directory,
    relative_existing_note_path,
    safe_note_destination,
)
from core.events import publish_note_change
from core.note_index import NoteIndex, get_note_index
from core.notes import (
    Note,
    NoteMeta,
    atomic_write_text,
    generate_id,
    now_iso,
    parse_note,
)
from core.notes_helpers import TYPE_TO_FOLDER, to_kebab
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager
from core.vault_io import VaultIOError
from core.vault_io import write_note as vault_write_note

logger = logging.getLogger(__name__)

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
    title: str | None = None
    # Optimistic concurrency: the ``modified`` timestamp the client last saw.
    # When present and stale (the note changed underneath — an agent edit or
    # another tab), the update is rejected with 409 instead of silently
    # clobbering the other write. Omit for last-write-wins (legacy clients).
    base_modified: str | None = None


class NoteListResponse(BaseModel):
    """Paginated list of note metadata."""

    notes: list[NoteMeta]
    total: int
    offset: int
    limit: int


class BulkNotesResponse(BaseModel):
    """Paginated list of full notes (frontmatter + body)."""

    notes: list[Note]
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


@router.get("/bulk")
@limiter.limit(READ_LIMIT)
async def list_notes_bulk(
    request: Request,  # noqa: ARG001 — required by slowapi
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> BulkNotesResponse:
    """List full notes (frontmatter + body) in one paginated request.

    Lets the frontend hydrate the whole vault without N+1 ``GET /{note_id}``
    calls that hammer the per-IP read limiter and silently drop notes past the
    cap. Bodies are read from disk off the event loop; an unreadable note is
    skipped rather than failing the page.
    """
    all_metas = sorted(index.all_metas(), key=lambda m: m.title.lower())
    total = len(all_metas)
    page = all_metas[offset : offset + limit]

    def _read_page() -> list[Note]:
        notes: list[Note] = []
        for meta in page:
            path = Path(meta.file_path)
            try:
                notes.append(parse_note(path))
            except (OSError, ValueError):
                logger.warning("Skipping unreadable note in bulk load: %s", path)
        return notes

    notes = await asyncio.to_thread(_read_page)
    return BulkNotesResponse(notes=notes, total=total, offset=offset, limit=limit)


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
            publish_note_change()
            return note
        except Exception:
            logger.warning("Weaver create_from_modal failed, falling back", exc_info=True)

    # Direct creation fallback (no Weaver or Weaver failed).
    tdir = vm.active_threads_dir()
    # Containment guard (H1): ``folder`` is attacker-influenced and was joined
    # straight into the path, so ``../../tmp`` could write outside the vault.
    # Resolve and require the target stays under threads/.
    target_dir = (tdir / folder).resolve()
    if not target_dir.is_relative_to(tdir.resolve()):
        raise HTTPException(status_code=400, detail=f"Invalid folder: {folder!r}")
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
    # Never clobber an existing note (deletion = archive, never silent loss).
    # Mirrors weaver_io.write_note's collision handling.
    if file_path.exists():
        file_path = target_dir / f"{stem}-{note_id}.md"
    # Route through the vault_io chokepoint so the write is re-validated against
    # the threads/ boundary (defense in depth behind the folder check above).
    try:
        vault_write_note(vm.active_vault_dir(), file_path, meta, body.content)
    except VaultIOError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Eagerly update the index so the new note is immediately findable
    index.refresh_file(file_path)
    note = parse_note(file_path)
    publish_note_change()
    return note


@router.put("/{note_id}")
@limiter.limit(WRITE_LIMIT)
async def update_note(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str,
    body: UpdateNoteRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Note:
    """Update a note's body, tags, or type.

    Serializes against concurrent agent edits (Spider/Scribe) via the shared
    ``path_lock`` and supports optimistic concurrency through
    ``base_modified``: if the note changed since the client loaded it, the
    update is rejected with 409 rather than silently dropping the other edit.
    """
    path = index.get_path_by_id(note_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")

    # Hold the per-path lock across the whole read-modify-write so a racing
    # agent backlink insertion can't be lost (and vice versa).
    async with path_lock(path):
        note = parse_note(path)

        if body.base_modified is not None and body.base_modified != note.modified:
            raise HTTPException(
                status_code=409,
                detail="Note was modified since it was loaded; reload and retry.",
            )

        ts = now_iso()
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["modified"] = ts

        if body.tags is not None:
            meta["tags"] = body.tags
        if body.type is not None:
            meta["type"] = body.type
        title_changed = body.title is not None and body.title.strip() != note.title
        if title_changed:
            meta["title"] = body.title.strip() if body.title else note.title

        meta["history"].append(
            {"action": "edited", "by": "user", "at": ts, "reason": "Updated via API"},
        )

        new_body = body.body if body.body is not None else note.body
        vault_write_note(vm.active_vault_dir(), path, meta, new_body)

        # If the title changed, rename the file to match the new kebab stem.
        if title_changed:
            new_stem = to_kebab(meta["title"]) or path.stem
            new_path = path.with_name(f"{new_stem}.md")
            if new_path != path:
                if new_path.exists():
                    raise HTTPException(
                        status_code=409,
                        detail=f"A note already exists at {new_path.name}",
                    )
                path.rename(new_path)
                index.remove_file(path)
                path = new_path

        index.refresh_file(path)
        updated = parse_note(path)
        publish_note_change()
        return updated


@router.delete("/{note_id}")
@limiter.limit(WRITE_LIMIT)
async def archive_note(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str,
    base_modified: str | None = Query(
        None,
        description="Reject the archive if the note changed since this timestamp",
    ),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, str]:
    """Archive a note under the shared writer lock with optional versioning."""
    path = index.get_path_by_id(note_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")

    result = await _archive_note_transaction(
        path=path,
        note_id=note_id,
        base_modified=base_modified,
        vault_root=vm.active_vault_dir(),
        threads_dir=vm.active_threads_dir(),
        index=index,
    )
    publish_note_change()
    return result


async def _archive_note_transaction(
    *,
    path: Path,
    note_id: str,
    base_modified: str | None,
    vault_root: Path,
    threads_dir: Path,
    index: NoteIndex,
) -> dict[str, str]:
    """Perform the archive read-modify-move as one rollback-safe operation."""
    async with path_lock(path):
        # The index lookup happens before waiting for the lock. Revalidate both
        # identity and location after acquiring it in case a title edit renamed
        # the file while this request was queued.
        current_path = index.get_path_by_id(note_id)
        if current_path is None or current_path.resolve() != path.resolve() or not path.exists():
            raise HTTPException(
                status_code=409,
                detail="Note changed location while being archived; reload and retry.",
            )

        try:
            original_rel = relative_existing_note_path(threads_dir, path)
        except ArchivePathError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        original_content = path.read_text(encoding="utf-8")
        note = parse_note(path)
        if base_modified is not None and base_modified != note.modified:
            raise HTTPException(
                status_code=409,
                detail="Note was modified since it was loaded; reload and retry.",
            )

        ts = now_iso()
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["status"] = "archived"
        meta["modified"] = ts
        # Persist the exact threads/-relative location. This is authoritative
        # during restore and keeps custom/nested folders intact even when an
        # archive filename needs a collision suffix.
        meta[ARCHIVE_ORIGINAL_PATH_FIELD] = original_rel.as_posix()
        meta["history"].append(
            {
                "action": "archived",
                "by": "user",
                "at": ts,
                "reason": "Archived via API",
            },
        )

        archive_dir = _archive_directory(threads_dir)

        # Source paths have independent locks, so serialize destination choice
        # as well. This prevents simultaneous same-filename archives from
        # selecting and replacing the same target.
        async with path_lock(archive_dir / ".destination-lock"):
            try:
                dest = _available_archive_path(archive_dir, original_rel, note_id)
            except ArchivePathError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            try:
                # Keep the frontmatter write and same-filesystem move in one
                # await-free critical section. Request cancellation therefore
                # cannot strand an active note with archived frontmatter.
                vault_write_note(vault_root, path, meta, note.body)
                for _attempt in range(100):
                    try:
                        _move_note_to_archive(path, dest)
                        break
                    except FileExistsError:
                        # Another process may create ``dest`` after our
                        # exists-check. Re-select and retry without overwriting
                        # it; the source still exists until the link succeeds.
                        dest = _available_archive_path(archive_dir, original_rel, note_id)
                else:
                    raise OSError("Could not reserve a collision-free archive path")
            except Exception as exc:
                rollback_error = _restore_failed_archive(path, dest, original_content)
                detail = "Failed to archive note; the original note was restored."
                if rollback_error is not None:
                    logger.critical(
                        "Archive move and rollback both failed for %s: %s",
                        path,
                        rollback_error,
                        exc_info=True,
                    )
                    detail = "Failed to archive note and could not restore the original file."
                raise HTTPException(status_code=500, detail=detail) from exc

        index.remove_file(path)
        return {"status": "archived", "path": str(dest)}


def _available_archive_path(
    archive_dir: Path,
    relative_path: Path,
    note_id: str,
) -> Path:
    """Choose a collision-free deterministic archive destination."""
    candidate = safe_note_destination(archive_dir, relative_path)
    if not _path_occupied(candidate):
        return candidate
    safe_id = to_kebab(note_id) or "archived"
    candidate = candidate.with_stem(f"{candidate.stem}-{safe_id}")
    suffix = 2
    while _path_occupied(candidate):
        candidate = candidate.with_name(f"{relative_path.stem}-{safe_id}-{suffix}.md")
        suffix += 1
    return candidate


def _path_occupied(path: Path) -> bool:
    """Treat dangling symlinks as occupied destinations too."""
    return path.exists() or path.is_symlink()


def _archive_directory(threads_dir: Path) -> Path:
    """Create and validate the reserved archive directory without following links."""
    try:
        result = archive_directory(threads_dir, create=True)
    except ArchivePathError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    assert result is not None
    return result


def _move_note_to_archive(source: Path, destination: Path) -> None:
    """Move a note without replacing a concurrently-created destination."""
    source_stat = source.stat(follow_symlinks=False)
    os.link(source, destination, follow_symlinks=False)
    try:
        destination_stat = destination.stat(follow_symlinks=False)
        if (destination_stat.st_dev, destination_stat.st_ino) != (
            source_stat.st_dev,
            source_stat.st_ino,
        ):
            raise OSError("Archive destination changed during reservation")
        source.unlink()
    except Exception:
        try:
            current = destination.stat(follow_symlinks=False)
            if (current.st_dev, current.st_ino) == (source_stat.st_dev, source_stat.st_ino):
                destination.unlink()
        except OSError:
            logger.warning(
                "Could not clean up failed archive destination %s",
                destination,
                exc_info=True,
            )
        raise


def _restore_failed_archive(
    source: Path,
    destination: Path,
    original_content: str,
) -> Exception | None:
    """Best-effort rollback for a failed archive move."""
    try:
        # A filesystem may report an error after completing the move. Move
        # the destination back first in that uncommon state, then restore the
        # exact pre-archive bytes in either case.
        if destination.exists() and not source.exists():
            os.link(destination, source, follow_symlinks=False)
            destination.unlink()
        elif destination.exists() and source.exists():
            # A failed source unlink can leave both hard links behind. Remove
            # only the destination that still names our source inode.
            source_stat = source.stat(follow_symlinks=False)
            destination_stat = destination.stat(follow_symlinks=False)
            if (source_stat.st_dev, source_stat.st_ino) == (
                destination_stat.st_dev,
                destination_stat.st_ino,
            ):
                destination.unlink()
        atomic_write_text(source, original_content)
    except Exception as exc:
        return exc
    return None

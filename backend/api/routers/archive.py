"""Archived-notes (trash) API routes: list and rollback-safe restore.

New note archives preserve their validated ``threads/``-relative path both in
the archive layout and in frontmatter. Legacy archives remain compatible:
nested tree archives use their directory layout, while old flat archives fall
back to the note type's standard folder.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from agents.file_locks import path_lock
from core.archive_paths import (
    ARCHIVE_ORIGINAL_PATH_FIELD,
    ArchivePathError,
    archive_directory,
    relative_existing_note_path,
    safe_note_destination,
    validate_relative_note_path,
)
from core.events import publish_note_change
from core.note_index import NoteIndex, get_note_index
from core.notes import Note, now_iso, parse_note
from core.notes_helpers import TYPE_TO_FOLDER
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager
from core.vault_io import VaultIOError
from core.vault_io import write_note_exclusive as vault_write_note_exclusive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/archive", tags=["archive"])


# -- Response models ----------------------------------------------------------


class ArchivedNote(BaseModel):
    """An archived note as surfaced in the trash listing."""

    id: str
    title: str
    type: str
    # Path the note will be restored to, relative to ``threads/``.
    original_path: str
    archived_at: str


class ArchivedListResponse(BaseModel):
    """The list of archived notes in the active vault."""

    notes: list[ArchivedNote]


# -- Archive scanning helpers -------------------------------------------------


def _scan_archive(threads_dir: Path) -> list[tuple[Path, Note]]:
    """Parse every ``.md`` file under ``threads/.archive/``.

    Returns ``(archive_file, parsed_note)`` pairs. Unreadable files are
    skipped rather than failing the whole listing.
    """
    archive_dir = archive_directory(threads_dir, create=False)
    if archive_dir is None:
        return []

    pairs: list[tuple[Path, Note]] = []
    for md in sorted(archive_dir.rglob("*.md")):
        try:
            # Reject archive file symlinks and any path that resolves outside
            # the archive root before parsing it.
            relative_existing_note_path(archive_dir, md)
            pairs.append((md, parse_note(md)))
        except (ArchivePathError, OSError, ValueError):
            logger.warning("Skipping unreadable archived note: %s", md)
    return pairs


def _original_rel_path(archive_dir: Path, archive_file: Path, note: Note) -> Path:
    """Compute the restore target for an archived file, relative to ``threads/``.

    The persisted original path is authoritative for new archives. For legacy
    files, a nested archive path is treated as the original tree location;
    old flat archives fall back to the type-derived standard folder.
    """
    stored = note.extra.get(ARCHIVE_ORIGINAL_PATH_FIELD)
    if stored is not None:
        return validate_relative_note_path(stored)

    rel = relative_existing_note_path(archive_dir, archive_file)
    if rel.parent != Path("."):
        return validate_relative_note_path(rel)
    folder = TYPE_TO_FOLDER.get(note.type, "topics")
    return validate_relative_note_path(Path(folder) / rel.name)


def _archived_at(note: Note) -> str:
    """Best-effort timestamp for when a note was archived.

    Prefers the most recent ``archived`` history entry (note-level archive
    stamps one); falls back to ``modified`` for tree-level archives that move
    the file without touching its frontmatter.
    """
    for entry in reversed(note.history):
        if entry.action == "archived":
            return entry.at
    return note.modified


# -- Endpoints ----------------------------------------------------------------


@router.get("")
@limiter.limit(READ_LIMIT)
def list_archived(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ArchivedListResponse:
    """List archived notes in the active vault, newest first."""
    threads_dir = vm.active_threads_dir()
    try:
        archive_dir = archive_directory(threads_dir, create=False)
        pairs = _scan_archive(threads_dir)
    except ArchivePathError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if archive_dir is None:
        return ArchivedListResponse(notes=[])

    notes: list[ArchivedNote] = []
    for archive_file, note in pairs:
        if not note.id:
            continue
        try:
            original_rel = _original_rel_path(archive_dir, archive_file, note)
        except ArchivePathError:
            logger.warning(
                "Skipping archived note with an unsafe original path: %s",
                archive_file,
            )
            continue
        notes.append(
            ArchivedNote(
                id=note.id,
                title=note.title,
                type=note.type,
                original_path=original_rel.as_posix(),
                archived_at=_archived_at(note),
            )
        )
    notes.sort(key=lambda n: n.archived_at, reverse=True)
    return ArchivedListResponse(notes=notes)


@router.post("/{note_id}/restore")
@limiter.limit(WRITE_LIMIT)
async def restore_archived(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Note:
    """Restore an archived note to its original folder.

    Re-activates the note, creates the live file with exclusive no-clobber
    semantics, removes the archive only after that succeeds, and rolls the new
    file back if the archive cannot be removed.

    Fails with 404 if no archived note has that id, and 409 if an active note
    already occupies the original path (rename/move it first, then retry).
    """
    threads_dir = vm.active_threads_dir()
    try:
        archive_dir = archive_directory(threads_dir, create=False)
        pairs = _scan_archive(threads_dir)
    except ArchivePathError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    match = next(((f, n) for f, n in pairs if n.id == note_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail=f"Archived note '{note_id}' not found")
    assert archive_dir is not None

    archive_file, _scanned_note = match
    async with path_lock(archive_file):
        # Revalidate the file and its identity after waiting for the lock; the
        # listing scan is only a lookup hint and may already be stale.
        try:
            current_archive_dir = archive_directory(threads_dir, create=False)
            if current_archive_dir is None:
                raise ArchivePathError("The note archive no longer exists")
            relative_existing_note_path(current_archive_dir, archive_file)
            note = parse_note(archive_file)
        except (ArchivePathError, OSError, ValueError) as exc:
            raise HTTPException(
                status_code=409,
                detail="Archived note changed while it was being restored; retry.",
            ) from exc
        if note.id != note_id:
            raise HTTPException(
                status_code=409,
                detail="Archived note changed while it was being restored; retry.",
            )

        try:
            rel = _original_rel_path(current_archive_dir, archive_file, note)
            dest = safe_note_destination(threads_dir, rel)
        except ArchivePathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        async with path_lock(dest):
            if _path_occupied(dest):
                raise _restore_collision(rel)

            ts = now_iso()
            meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
            meta["status"] = "active"
            meta["modified"] = ts
            extra = dict(meta.get("extra") or {})
            extra.pop(ARCHIVE_ORIGINAL_PATH_FIELD, None)
            meta["extra"] = extra
            meta.pop(ARCHIVE_ORIGINAL_PATH_FIELD, None)
            meta["history"].append(
                {
                    "action": "restored",
                    "by": "user",
                    "at": ts,
                    "reason": "Restored from archive via API",
                },
            )

            try:
                created_identity = vault_write_note_exclusive(
                    vm.active_vault_dir(),
                    dest,
                    meta,
                    note.body,
                )
            except FileExistsError as exc:
                raise _restore_collision(rel) from exc
            except VaultIOError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

            try:
                if _file_identity(dest) != created_identity:
                    raise OSError("Restored destination changed before archive commit")
                _remove_archive_file(archive_file)
            except OSError as exc:
                # Some filesystems can report an unlink error after completing
                # it. If the archive is gone, keep the newly-created live note
                # and treat the transaction as committed.
                if archive_file.exists() or archive_file.is_symlink():
                    rollback_error = _rollback_restored_file(dest, created_identity)
                    detail = "Failed to restore note; the archived copy was preserved."
                    if rollback_error is not None:
                        logger.critical(
                            "Restore commit and rollback both failed for %s: %s",
                            archive_file,
                            rollback_error,
                            exc_info=True,
                        )
                        detail = (
                            "Failed to finish restoring the note and could not safely "
                            "remove the partial live copy."
                        )
                    raise HTTPException(status_code=500, detail=detail) from exc

            index.remove_file(archive_file)
            index.refresh_file(dest)
            restored = parse_note(dest)

    publish_note_change()
    return restored


def _path_occupied(path: Path) -> bool:
    """Treat a dangling symlink as an occupied destination."""
    return path.exists() or path.is_symlink()


def _restore_collision(rel: Path) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail=(
            f"Cannot restore: a note already exists at {rel.as_posix()}. "
            "Rename or move that note first, then retry."
        ),
    )


def _file_identity(path: Path) -> tuple[int, int]:
    stat_result = path.stat(follow_symlinks=False)
    return stat_result.st_dev, stat_result.st_ino


def _remove_archive_file(path: Path) -> None:
    """Commit a restore by removing its archived source."""
    path.unlink()


def _rollback_restored_file(
    path: Path,
    expected_identity: tuple[int, int],
) -> Exception | None:
    """Remove only the live file created by this restore attempt."""
    try:
        if _file_identity(path) != expected_identity:
            raise OSError("Restore destination was replaced; refusing to remove it")
        path.unlink()
    except FileNotFoundError:
        return None
    except Exception as exc:
        return exc
    return None

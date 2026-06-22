"""Archived-notes (trash) API routes: list and restore.

Loom never truly deletes a note — archiving moves the file under
``threads/.archive/`` and (for the notes endpoint) flips ``status`` to
``archived``. Until now the only way back was to move files by hand. This
router surfaces the archive and restores a note to its original folder,
routing the write back through the ``vault_io`` chokepoint so the same path
validations that guard every other vault write apply here too.

Two archive layouts exist and both are handled:

- ``DELETE /api/notes/{id}`` (``notes.py``) flattens the file to
  ``.archive/<filename>`` — the original folder is recovered from the note's
  ``type``.
- ``DELETE /api/tree/path/...`` (``tree.py``) preserves the sub-path under
  ``.archive/<folder>/<filename>`` — that relative path *is* the original
  location.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.note_index import NoteIndex, get_note_index
from core.notes import Note, now_iso, parse_note
from core.notes_helpers import TYPE_TO_FOLDER
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager
from core.vault_io import VaultIOError
from core.vault_io import write_note as vault_write_note

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
    archive_dir = threads_dir / ".archive"
    if not archive_dir.exists():
        return []

    pairs: list[tuple[Path, Note]] = []
    for md in sorted(archive_dir.rglob("*.md")):
        if not md.is_file():
            continue
        try:
            pairs.append((md, parse_note(md)))
        except (OSError, ValueError):
            logger.warning("Skipping unreadable archived note: %s", md)
    return pairs


def _original_rel_path(archive_dir: Path, archive_file: Path, note: Note) -> Path:
    """Compute the restore target for an archived file, relative to ``threads/``.

    If the file was archived with its folder structure preserved (tree-level
    archive), that relative path is the original location. If it was flattened
    to the archive root (note-level archive), the folder is recovered from the
    note's ``type`` — falling back to ``topics`` for unknown/custom types.
    """
    rel = archive_file.relative_to(archive_dir)
    if rel.parent != Path("."):
        return rel
    folder = TYPE_TO_FOLDER.get(note.type, "topics")
    return Path(folder) / rel.name


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
    archive_dir = threads_dir / ".archive"

    notes = [
        ArchivedNote(
            id=note.id,
            title=note.title,
            type=note.type,
            original_path=str(_original_rel_path(archive_dir, archive_file, note)),
            archived_at=_archived_at(note),
        )
        for archive_file, note in _scan_archive(threads_dir)
        if note.id
    ]
    notes.sort(key=lambda n: n.archived_at, reverse=True)
    return ArchivedListResponse(notes=notes)


@router.post("/{note_id}/restore")
@limiter.limit(WRITE_LIMIT)
def restore_archived(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Note:
    """Restore an archived note to its original folder.

    Re-activates the note (``status=active`` + a ``restored`` history entry),
    writes it back through the ``vault_io`` chokepoint, removes the archived
    copy, and re-adds it to the index. The destination write is decomposed into
    a validated write + an unlink of the archive copy so the chokepoint — which
    *refuses* ``.archive/`` writes — still governs the live file.

    Fails with 404 if no archived note has that id, and 409 if an active note
    already occupies the original path (rename/move it first, then retry).
    """
    threads_dir = vm.active_threads_dir()
    archive_dir = threads_dir / ".archive"

    match = next(
        ((f, n) for f, n in _scan_archive(threads_dir) if n.id == note_id),
        None,
    )
    if match is None:
        raise HTTPException(status_code=404, detail=f"Archived note '{note_id}' not found")

    archive_file, note = match
    rel = _original_rel_path(archive_dir, archive_file, note)
    dest = threads_dir / rel

    # Collision: an active note now occupies the original path. Never clobber
    # it — surface a clear, actionable error instead.
    if dest.exists():
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot restore: a note already exists at {rel}. "
                "Rename or move that note first, then retry."
            ),
        )

    ts = now_iso()
    meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["status"] = "active"
    meta["modified"] = ts
    meta["history"].append(
        {"action": "restored", "by": "user", "at": ts, "reason": "Restored from archive via API"},
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    # Route the write through the chokepoint so the threads/ boundary is
    # re-validated (defense in depth — ``rel`` is server-derived but cheap to
    # re-check).
    try:
        vault_write_note(vm.active_vault_dir(), dest, meta, note.body)
    except VaultIOError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Drop the archived copy now that the live note exists.
    archive_file.unlink()

    # Re-index: the restored note is immediately findable and in the graph.
    index.remove_file(archive_file)
    index.refresh_file(dest)

    return parse_note(dest)

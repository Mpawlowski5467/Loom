"""Weaver helper: filesystem operations for writing and archiving notes."""

from __future__ import annotations

import logging
import shutil
from typing import TYPE_CHECKING

from agents.changelog import log_action
from agents.loom.weaver_helpers import build_meta
from core.note_index import get_note_index
from core.notes import (
    Note,
    generate_id,
    now_iso,
    parse_note,
)
from core.notes_helpers import to_kebab
from core.vault_io import write_note as _vault_write_note

if TYPE_CHECKING:
    from pathlib import Path

    from core.notes import NoteMeta

logger = logging.getLogger(__name__)


def find_note_by_capture_source(vault_root: Path, capture_id: str) -> NoteMeta | None:
    """Return an existing note created from a given capture, if any.

    Looks for a note whose ``source`` is ``capture:{capture_id}`` — the marker
    Weaver writes when it files a capture. Used to make pipeline re-runs
    idempotent: if a crash happened after the note was written but before the
    capture was archived, a retry finds the note here instead of creating a
    duplicate. Keyed on the capture *id* (stable), never the title (titles
    legitimately collide).

    Args:
        vault_root: Root of the vault whose Markdown source of truth is searched.
        capture_id: The originating capture's frontmatter id.

    Returns:
        The matching ``NoteMeta`` from the in-memory index, or ``None``.
    """
    if not capture_id:
        return None
    target = f"capture:{capture_id}"
    for meta in get_note_index().all_metas():
        if meta.source == target:
            return meta

    # The watcher/index refresh is asynchronous. A retry can arrive after the
    # note write but before NoteIndex sees it, so fall back to the Markdown source
    # of truth rather than creating a duplicate.
    from core.notes import parse_note_meta

    threads_dir = vault_root / "threads"
    if not threads_dir.exists():
        return None
    for path in threads_dir.rglob("*.md"):
        if ".archive" in path.parts:
            continue
        try:
            meta = parse_note_meta(path)
        except (OSError, ValueError):
            continue
        if meta.source == target:
            return meta
    return None


def write_note(
    vault_root: Path,
    title: str,
    note_type: str,
    tags: list[str],
    folder: str,
    body: str,
    source: str = "manual",
    author: str = "agent:weaver",
) -> Note:
    """Write a note file to the vault and return the parsed Note."""
    threads_dir = vault_root / "threads"

    if ".." in folder or folder.startswith("/") or "/" in folder.strip("/") or "\\" in folder:
        logger.warning(
            "Weaver: suspicious folder '%s' from classification — falling back to captures/",
            folder,
        )
        folder = "captures"

    target_dir = (threads_dir / folder).resolve()
    if not str(target_dir).startswith(str(threads_dir.resolve())):
        logger.warning(
            "Weaver: folder '%s' escapes threads/ — falling back to captures/",
            folder,
        )
        folder = "captures"
        target_dir = threads_dir / folder

    target_dir.mkdir(parents=True, exist_ok=True)

    note_id = generate_id()
    stem = to_kebab(title) or note_id
    file_path = target_dir / f"{stem}.md"

    if file_path.exists():
        file_path = target_dir / f"{stem}-{note_id}.md"

    meta = build_meta(note_id, title, note_type, tags, source, author)
    _vault_write_note(vault_root, file_path, meta, body)

    logger.info("Weaver created note: %s → %s", title, file_path)
    return parse_note(file_path)


def archive_note(
    vault_root: Path,
    agent_name: str,
    note_path: Path,
    reason: str,
) -> Path:
    """Move a note into ``threads/.archive/`` (deletion = archive).

    Used by the capture pipeline's Sentinel-retry loop to retire the rejected
    first-attempt note when Weaver regenerates a replacement, so one capture
    never leaves two active notes both tagged ``source: capture:<id>``. Updates
    the note's frontmatter (``status=archived`` + history) before moving it.
    """
    archive_dir = vault_root / "threads" / ".archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    note = parse_note(note_path)
    ts = now_iso()
    meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["status"] = "archived"
    meta["modified"] = ts
    meta.setdefault("history", []).append(
        {"action": "archived", "by": f"agent:{agent_name}", "at": ts, "reason": reason},
    )
    _vault_write_note(vault_root, note_path, meta, note.body)

    dest = archive_dir / note_path.name
    if dest.exists():
        safe_ts = ts.replace(":", "-")
        dest = dest.with_stem(f"{dest.stem}-{safe_ts}")
    shutil.move(str(note_path), str(dest))
    get_note_index().remove_file(note_path)

    log_action(
        vault_root,
        agent_name,
        "archived",
        str(note_path),
        details=f"Archived superseded note → {dest.name} ({reason})",
        chain_status="pass",
    )
    logger.info("Archived superseded note: %s → %s", note_path.name, dest)
    return dest


def archive_capture(vault_root: Path, agent_name: str, capture_path: Path) -> Path:
    """Move a processed capture into ``threads/.archive/``.

    Updates the capture's frontmatter (``status=archived`` + history entry)
    before moving the file, and records the action in the changelog. On a
    destination filename collision, the timestamp is appended to the stem.
    """
    archive_dir = vault_root / "threads" / ".archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    capture = parse_note(capture_path)
    ts = now_iso()
    meta = capture.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["status"] = "archived"
    meta["modified"] = ts
    meta.setdefault("history", []).append(
        {
            "action": "archived",
            "by": f"agent:{agent_name}",
            "at": ts,
            "reason": "Archived after Weaver processing",
        },
    )
    _vault_write_note(vault_root, capture_path, meta, capture.body)

    dest = archive_dir / capture_path.name
    if dest.exists():
        safe_ts = ts.replace(":", "-")
        dest = dest.with_stem(f"{dest.stem}-{safe_ts}")
    shutil.move(str(capture_path), str(dest))

    log_action(
        vault_root,
        agent_name,
        "archived",
        str(capture_path),
        details=f"Archived processed capture → {dest.name}",
        chain_status="pass",
    )
    logger.info("Weaver archived capture: %s → %s", capture_path.name, dest)
    return dest

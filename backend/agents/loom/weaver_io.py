"""Weaver helper: filesystem operations for writing and archiving notes."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from agents.changelog import log_action
from agents.loom.weaver_helpers import build_meta
from core.notes import (
    Note,
    atomic_write_text,
    generate_id,
    note_to_file_content,
    now_iso,
    parse_note,
)
from core.notes_helpers import to_kebab

logger = logging.getLogger(__name__)


def write_note(
    vault_root: Path,
    title: str,
    note_type: str,
    tags: list[str],
    folder: str,
    body: str,
    source: str = "manual",
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

    meta = build_meta(note_id, title, note_type, tags, source)
    atomic_write_text(file_path, note_to_file_content(meta, body))

    logger.info("Weaver created note: %s → %s", title, file_path)
    return parse_note(file_path)


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
    atomic_write_text(capture_path, note_to_file_content(meta, capture.body))

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

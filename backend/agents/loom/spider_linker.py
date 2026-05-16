"""Spider helper: applying wikilinks (and reciprocal backlinks)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from agents.loom.spider_lookup import build_title_map
from core.notes import Note, atomic_write_text, note_to_file_content, now_iso, parse_note

if TYPE_CHECKING:
    from pathlib import Path


def apply_links(
    vault_root: Path,
    source_path: Path,
    source_note: Note,
    target_titles: list[str],
) -> list[str]:
    """Add wikilinks to source note and reciprocal backlinks to targets.

    Returns the list of titles that were actually linked.
    """
    threads_dir = vault_root / "threads"
    title_map = build_title_map(threads_dir)
    ts = now_iso()
    linked: list[str] = []

    for title in target_titles:
        target_path = title_map.get(title.lower())
        if target_path is None or target_path == source_path:
            continue

        _add_link_to_note(source_path, title, ts, f"Spider linked to [[{title}]]")
        _add_link_to_note(
            target_path,
            source_note.title,
            ts,
            f"Spider added backlink from [[{source_note.title}]]",
        )
        linked.append(title)

    return linked


def _add_link_to_note(path: Path, link_title: str, ts: str, reason: str) -> None:
    """Append a wikilink to a note if not already present."""
    note = parse_note(path)
    if link_title.lower() in [wl.lower() for wl in note.wikilinks]:
        return

    new_body = note.body.rstrip() + f"\n\n[[{link_title}]]\n"

    meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["modified"] = ts
    meta["history"].append({"action": "linked", "by": "agent:spider", "at": ts, "reason": reason})

    atomic_write_text(path, note_to_file_content(meta, new_body))

"""Spider helper: applying wikilinks (and reciprocal backlinks)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from agents.file_locks import path_lock
from agents.loom.spider_lookup import build_title_map
from core.notes import Note, now_iso, parse_note
from core.vault_io import write_note as _vault_write_note

if TYPE_CHECKING:
    from pathlib import Path


async def apply_links(
    vault_root: Path,
    source_path: Path,
    source_note: Note,
    target_titles: list[str],
) -> list[str]:
    """Add wikilinks to source note and reciprocal backlinks to targets.

    Returns the list of titles that were actually linked. Each note edit
    is serialized via ``path_lock`` so concurrent Spider runs on different
    captures can't lose each other's link updates.
    """
    threads_dir = vault_root / "threads"
    title_map = build_title_map(threads_dir)
    ts = now_iso()
    linked: list[str] = []

    for title in target_titles:
        target_path = title_map.get(title.lower())
        if target_path is None or target_path == source_path:
            continue

        await _add_link_to_note(
            vault_root, source_path, title, ts, f"Spider linked to [[{title}]]"
        )
        await _add_link_to_note(
            vault_root,
            target_path,
            source_note.title,
            ts,
            f"Spider added backlink from [[{source_note.title}]]",
        )
        linked.append(title)

    return linked


async def _add_link_to_note(
    vault_root: Path, path: Path, link_title: str, ts: str, reason: str
) -> None:
    """Append a wikilink to a note if not already present.

    Held under a path lock for the full read-modify-write so a concurrent
    writer can't slip a change in between ``parse_note`` and the write.
    Goes through ``vault_io.write_note`` so path safety is enforced.
    """
    async with path_lock(path):
        note = parse_note(path)
        if link_title.lower() in [wl.lower() for wl in note.wikilinks]:
            return

        new_body = note.body.rstrip() + f"\n\n[[{link_title}]]\n"

        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["modified"] = ts
        meta["history"].append(
            {"action": "linked", "by": "agent:spider", "at": ts, "reason": reason}
        )

        _vault_write_note(vault_root, path, meta, new_body)

"""Spider helper: applying wikilinks (and reciprocal backlinks).

The duplicate-check here compares *resolved targets*, not raw wikilink text.
Two wikilinks pointing at the same note can spell its title differently
(e.g. ``[[inventory-sync-refactor]]`` from the user, ``[[Inventory Sync
Refactor]]`` from the title-map), and a naive string compare treats them
as distinct — which used to make Spider append the same link over and
over on every scan.

The fix: resolve every existing wikilink in the note to a *file path*
via the title-map, and treat the target as "already linked" if its path
shows up in that resolved set.
"""

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

        wrote_forward = await _add_link_to_note(
            vault_root, source_path, target_path, title, ts,
            f"Spider linked to [[{title}]]", title_map,
        )
        wrote_back = await _add_link_to_note(
            vault_root, target_path, source_path, source_note.title, ts,
            f"Spider added backlink from [[{source_note.title}]]", title_map,
        )
        # Only count as newly-linked if at least one direction actually
        # wrote. If both sides already had the link, we report nothing
        # rather than lying about a no-op.
        if wrote_forward or wrote_back:
            linked.append(title)

    return linked


async def _add_link_to_note(
    vault_root: Path,
    path: Path,
    target_path: Path,
    link_title: str,
    ts: str,
    reason: str,
    title_map: dict[str, "Path"],
) -> bool:
    """Append a wikilink to a note if the target isn't already linked.

    Returns True if the write happened, False if the dup-check skipped it.

    "Already linked" means: at least one existing wikilink in the note
    resolves (via the title-map) to ``target_path``. This catches both
    kebab-case and title-case spellings of the same target, which a raw
    string compare would miss.

    Held under a path lock for the full read-modify-write so a concurrent
    writer can't slip a change in between ``parse_note`` and the write.
    Goes through ``vault_io.write_note`` so path safety is enforced.
    """
    async with path_lock(path):
        note = parse_note(path)

        # Build a richer lookup that accepts both titles and filename slugs.
        # ``title_map`` from the note index keys by lowercased title only,
        # but users write ``[[alpha-topic]]`` as often as ``[[Alpha Topic]]``,
        # and both must resolve to the same file when checking for dupes.
        rich_map: dict[str, "Path"] = dict(title_map)
        for resolved_path in title_map.values():
            rich_map.setdefault(resolved_path.stem.lower(), resolved_path)
        # Also index the target by its own stem so the resolve-by-path
        # comparison below works regardless of how the existing wikilinks
        # spell the target.
        rich_map.setdefault(target_path.stem.lower(), target_path)

        # Resolve every existing wikilink in the note to a file path.
        # Anything that doesn't resolve (e.g. dangling link) stays in the
        # set as its lowercased string so we still catch text-level dupes.
        existing_targets: set[object] = set()
        for wl in note.wikilinks:
            # Strip [[alias|target]] and [[note#anchor]] decorations.
            key = wl.split("|", 1)[0].split("#", 1)[0].strip().lower()
            resolved = rich_map.get(key)
            if resolved is not None:
                existing_targets.add(resolved.resolve())
            else:
                existing_targets.add(key)

        if target_path.resolve() in existing_targets:
            return False
        # Belt-and-braces: also catch the case where the new link_title
        # itself is a dangling reference but matches a string we already
        # have (e.g. someone wrote [[Foo]] free-form and Spider wants to
        # add [[Foo]] again).
        if link_title.strip().lower() in existing_targets:
            return False

        new_body = note.body.rstrip() + f"\n\n[[{link_title}]]\n"

        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["modified"] = ts
        meta["history"].append(
            {"action": "linked", "by": "agent:spider", "at": ts, "reason": reason}
        )

        _vault_write_note(vault_root, path, meta, new_body)
        return True

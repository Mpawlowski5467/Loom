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

import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING

from agents.file_locks import path_lock
from agents.loom.spider_lookup import build_title_map
from core.notes import Note, now_iso, parse_note
from core.traces import get_run
from core.vault_io import write_note as _vault_write_note
from core.wikilinks import link_target

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)


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
        target_path = title_map.get(link_target(title))
        if target_path is None or target_path == source_path:
            continue
        if ".archive" in target_path.parts:
            # Archived notes never receive backlinks — vault_io refuses the
            # write, and the link would be invisible to scans anyway. A stale
            # title-map entry (note archived mid-scan) must skip, not fail.
            logger.debug("Skipping link to archived note: %s", target_path)
            continue
        if not target_path.exists():
            # Stale index entry — the note was archived or renamed after the
            # title-map was built (e.g. a capture enforce-archived mid-scan).
            continue

        wrote_forward = await _add_link_to_note(
            vault_root,
            source_path,
            target_path,
            title,
            ts,
            f"Spider linked to [[{title}]]",
            title_map,
            evidence={
                "source_id": source_note.id,
                "target_id": parse_note(target_path).id,
                "score": 1.0,
                "method": "spider-resolved-title",
                "reason": "Resolved title match; reciprocal link written.",
                "source_excerpt": source_note.body[:280],
                "target_excerpt": parse_note(target_path).body[:280],
                "created": ts,
                "agent": "spider",
                "run_id": get_run(),
                "state": "applied",
            },
        )
        wrote_back = await _add_link_to_note(
            vault_root,
            target_path,
            source_path,
            source_note.title,
            ts,
            f"Spider added backlink from [[{source_note.title}]]",
            title_map,
        )
        # Only count as newly-linked if at least one direction actually
        # wrote. If both sides already had the link, we report nothing
        # rather than lying about a no-op.
        if wrote_forward or wrote_back:
            linked.append(title)

    return linked


async def persist_suggestions(
    vault_root: Path, source_path: Path, source_note: Note, candidates: Sequence[object]
) -> None:
    """Persist reviewable suggested candidates without changing note links."""
    title_map = build_title_map(vault_root / "threads")
    entries: list[dict[str, object]] = []
    for candidate in candidates:
        title = getattr(candidate, "title", "")
        target_path = title_map.get(link_target(title))
        if not title or target_path is None or not target_path.exists():
            continue
        target = parse_note(target_path)
        entries.append(
            {
                "source_id": source_note.id,
                "target_id": target.id,
                "score": round(float(getattr(candidate, "score", 0)), 4),
                "method": "spider-candidate",
                "reason": str(getattr(candidate, "reason", "Deterministic Spider candidate."))
                or "Deterministic Spider candidate.",
                "source_excerpt": source_note.body[:280],
                "target_excerpt": target.body[:280],
                "created": now_iso(),
                "agent": "spider",
                "run_id": get_run(),
                "state": "suggested",
            }
        )
    if not entries:
        return
    async with path_lock(source_path):
        note = parse_note(source_path)
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        existing = [
            item
            for item in note.extra.get("link_evidence", [])
            if not (isinstance(item, dict) and item.get("state") == "suggested")
        ]
        meta["link_evidence"] = [*existing, *entries][-100:]
        meta["modified"] = now_iso()
        _vault_write_note(vault_root, source_path, meta, note.body)


async def _add_link_to_note(
    vault_root: Path,
    path: Path,
    target_path: Path,
    link_title: str,
    ts: str,
    reason: str,
    title_map: dict[str, Path],
    evidence: dict[str, object] | None = None,
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
        try:
            note = parse_note(path)
        except FileNotFoundError:
            # Vanished between the title-map lookup and the lock — archived
            # or renamed mid-scan. Skip rather than fail the whole scan.
            return False

        # The canonical map already includes unambiguous titles, slugs and
        # paths. Reintroducing a bare stem here would select arbitrary matches.
        rich_map = title_map

        # Resolve every existing wikilink in the note to a file path.
        # Anything that doesn't resolve (e.g. dangling link) stays in the
        # set as its lowercased string so we still catch text-level dupes.
        existing_targets: set[object] = set()
        for wl in note.wikilinks:
            # Strip [[alias|target]] and [[note#anchor]] decorations.
            key = link_target(wl)
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
        if (
            link_target(link_title) in existing_targets
            and rich_map.get(link_target(link_title)) == target_path
        ):
            return False

        if rich_map.get(link_target(link_title)) != target_path:
            canonical = target_path.relative_to(vault_root / "threads").with_suffix("")
            link_title = f"{canonical.as_posix()}|{link_title}"
        new_body = note.body.rstrip() + f"\n\n[[{link_title}]]\n"

        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["modified"] = ts
        meta["history"].append(
            {"action": "linked", "by": "agent:spider", "at": ts, "reason": reason}
        )
        if evidence is not None:
            prior = note.extra.get("link_evidence", [])
            meta["link_evidence"] = [*prior, evidence][-100:]

        _vault_write_note(vault_root, path, meta, new_body)
        return True

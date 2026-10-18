"""Canonical wikilink keys and ambiguity-safe resolution."""

from __future__ import annotations

import contextlib
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path

from core.notes import NoteMeta, normalize_wikilink_target


def link_target(raw: str) -> str:
    """Normalize a wikilink target, discarding alias and heading fragments."""
    target = normalize_wikilink_target(raw).split("|", 1)[0].split("#", 1)[0].strip()
    return target.replace("\\", "/").lower().removesuffix(".md")


def note_link_keys(meta: NoteMeta, path: Path) -> set[str]:
    """Return the stable id, title, slug, path, and aliases for a note."""
    keys = {link_target(meta.id), link_target(meta.title), link_target(path.stem)}
    threads = next((parent for parent in path.parents if parent.name == "threads"), None)
    if threads is not None:
        with contextlib.suppress(ValueError):
            keys.add(link_target(str(path.relative_to(threads).with_suffix(""))))
    aliases = meta.extra.get("aliases", [])
    if isinstance(aliases, list):
        keys.update(link_target(alias) for alias in aliases if isinstance(alias, str))
    return {key for key in keys if key}


def unique_link_map(entries: Iterable[tuple[NoteMeta, Path]]) -> dict[str, Path]:
    """Build a key-to-path map, withholding every ambiguous key."""
    candidates: dict[str, set[Path]] = defaultdict(set)
    for meta, path in entries:
        for key in note_link_keys(meta, path):
            candidates[key].add(path)
    return {key: next(iter(paths)) for key, paths in candidates.items() if len(paths) == 1}

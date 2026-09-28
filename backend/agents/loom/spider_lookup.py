"""Spider helper: note lookup / index resolution.

Pulls title-by-id, id-by-title, and title-map data either from the cached
NoteIndex (preferred) or by scanning disk as a fallback.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import yaml
from pydantic import ValidationError

from core.note_index import get_note_index
from core.notes import parse_note_meta

if TYPE_CHECKING:
    from pathlib import Path


def is_link_candidate(path: Path) -> bool:
    """Whether a note may be a Spider link source or target.

    Archived notes are out of the graph. Captures are raw Inbox items: the
    pipeline holds a capture's path lock while Spider links the note filed
    from it, so a backlink written into a capture would wait on that lock
    forever and deadlock the run. A capture's content reaches the graph
    through the note Weaver files from it, which is the real link target.
    """
    return ".archive" not in path.parts and "captures" not in path.parts


def resolve_title(vault_root: Path, note_id: str) -> str:
    """Look up a note title by ID from the index, falling back to disk."""
    index = get_note_index()
    if index.size > 0:
        entry = index.get_by_id(note_id)
        if entry is not None:
            # Watcher create/modify events can index notes living under
            # .archive/; archived notes and captures are never link targets.
            if not is_link_candidate(entry.file_path):
                return ""
            return entry.title
    threads_dir = vault_root / "threads"
    for md in threads_dir.rglob("*.md"):
        if not is_link_candidate(md):
            continue
        try:
            meta = parse_note_meta(md)
            if meta.id == note_id:
                return meta.title
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            continue
    return ""


def resolve_id(title: str, vault_notes: list[dict[str, Any]]) -> str:
    """Look up a note ID by title from a vault notes list."""
    for vn in vault_notes:
        if vn["title"].lower() == title.lower():
            return str(vn.get("id", ""))
    return ""


def list_vault_notes(threads_dir: Path, exclude_id: str = "") -> list[dict[str, Any]]:
    """List all vault notes as dicts with title and tags."""
    index = get_note_index()
    if index.size > 0:
        return [
            {"title": e.title, "tags": e.tags, "id": e.id}
            for e in index.all_entries()
            if e.id != exclude_id and is_link_candidate(e.file_path)
        ]
    notes: list[dict[str, Any]] = []
    if not threads_dir.exists():
        return notes
    for md in threads_dir.rglob("*.md"):
        if not is_link_candidate(md) or md.name == "_index.md":
            continue
        try:
            meta = parse_note_meta(md)
            if meta.id and meta.id != exclude_id:
                notes.append({"title": meta.title, "tags": list(meta.tags), "id": meta.id})
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            continue
    return notes


def build_title_map(threads_dir: Path) -> dict[str, Path]:
    """Build a lowercase-title → path map, preferring the cached NoteIndex."""
    index = get_note_index()
    if index.size > 0:
        # Built from every entry rather than ``get_title_map()``: that map keeps
        # one path per title, and a capture shares its title with the note
        # filed from it, so the capture could shadow the real link target.
        return {
            entry.title.lower(): entry.file_path
            for entry in index.all_entries()
            if entry.title and is_link_candidate(entry.file_path)
        }
    title_map: dict[str, Path] = {}
    for md in threads_dir.rglob("*.md"):
        if not is_link_candidate(md):
            continue
        try:
            meta = parse_note_meta(md)
            if meta.title:
                title_map[meta.title.lower()] = md
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            continue
    return title_map

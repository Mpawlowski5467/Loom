"""Spider helper: note lookup / index resolution.

Pulls title-by-id, id-by-title, and title-map data either from the cached
NoteIndex (preferred) or by scanning disk as a fallback.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from core.note_index import get_note_index
from core.notes import parse_note_meta


def resolve_title(vault_root: Path, note_id: str) -> str:
    """Look up a note title by ID from the index, falling back to disk."""
    index = get_note_index()
    if index.size > 0:
        entry = index.get_by_id(note_id)
        if entry is not None:
            return entry.title
    threads_dir = vault_root / "threads"
    for md in threads_dir.rglob("*.md"):
        if ".archive" in md.parts:
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
            if e.id != exclude_id
        ]
    notes: list[dict[str, Any]] = []
    if not threads_dir.exists():
        return notes
    for md in threads_dir.rglob("*.md"):
        if ".archive" in md.parts or md.name == "_index.md":
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
        return index.get_title_map()
    title_map: dict[str, Path] = {}
    for md in threads_dir.rglob("*.md"):
        if ".archive" in md.parts:
            continue
        try:
            meta = parse_note_meta(md)
            if meta.title:
                title_map[meta.title.lower()] = md
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            continue
    return title_map

"""Shared note helpers (dedup'd from routers/agents).

These helpers were previously duplicated across the API routers and the
Loom-layer agents. Centralising them avoids drift and keeps the
type→folder mapping and filename slugification in one place.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import date
    from pathlib import Path

# -- Note type → vault folder ------------------------------------------------

TYPE_TO_FOLDER: dict[str, str] = {
    "daily": "daily",
    "project": "projects",
    "topic": "topics",
    "person": "people",
    "capture": "captures",
}


def to_kebab(title: str) -> str:
    """Convert a title to a kebab-case filename stem (max 60 chars)."""
    cleaned = "".join(c if c.isalnum() or c in " -_" else "" for c in title)
    return "-".join(cleaned.lower().split())[:60]


def collect_changelog(vault_root: Path, target_date: date) -> str:
    """Return all per-agent changelog entries for ``target_date`` concatenated."""
    changelog_root = vault_root / ".loom" / "changelog"
    date_str = target_date.isoformat()
    parts: list[str] = []

    if not changelog_root.exists():
        return ""

    for agent_dir in sorted(changelog_root.iterdir()):
        if not agent_dir.is_dir():
            continue
        log_file = agent_dir / f"{date_str}.md"
        if not log_file.exists():
            continue
        try:
            parts.append(log_file.read_text(encoding="utf-8"))
        except OSError:
            continue
    return "\n\n".join(parts)

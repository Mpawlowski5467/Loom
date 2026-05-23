"""Pure helpers used by Weaver — extracted to keep ``weaver.py`` focused.

These helpers have no agent state; they read schemas off disk, parse LLM
classification output, and build frontmatter metadata dicts.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from core.notes import now_iso

if TYPE_CHECKING:
    from pathlib import Path


def parse_classification(text: str) -> dict[str, str]:
    """Parse the LLM classification response into a dict."""
    result: dict[str, str] = {}
    for line in text.strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip().lower()
            value = value.strip()
            if key in ("type", "folder", "title", "tags"):
                result[key] = value
    return result


def load_schema(vault_root: Path, note_type: str) -> str:
    """Load the schema template for a note type from ``rules/schemas/``."""
    schema_path = vault_root / "rules" / "schemas" / f"{note_type}.md"
    if schema_path.exists():
        return schema_path.read_text(encoding="utf-8")
    return ""


def build_meta(
    note_id: str,
    title: str,
    note_type: str,
    tags: list[str],
    source: str = "manual",
    author: str = "agent:weaver",
) -> dict[str, Any]:
    """Build a complete frontmatter metadata dict for a newly-written note.

    ``author`` attributes the create action. Defaults to ``agent:weaver`` for
    autonomous capture-processing; pass ``user`` (or another agent name) when
    the creation was user-initiated so the history entry doesn't misattribute.
    """
    ts = now_iso()
    is_user = author == "user"
    reason = "Initial creation" if is_user else "Created by Weaver agent"
    return {
        "id": note_id,
        "title": title,
        "type": note_type,
        "tags": tags,
        "created": ts,
        "modified": ts,
        "author": author,
        "source": source,
        "links": [],
        "status": "active",
        "history": [
            {
                "action": "created",
                "by": author,
                "at": ts,
                "reason": reason,
            },
        ],
    }

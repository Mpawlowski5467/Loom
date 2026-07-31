"""Shared note-section expectations, driven by the vault's on-disk schemas.

Weaver (skeleton bodies for new notes) and Sentinel (section compliance
checks) derive the expected ``## `` sections of a note type from the same
place, so the two agents can never disagree about what a healthy note looks
like:

1. the vault's on-disk schema (``rules/schemas/<type>.md``) when present;
2. the built-in skeleton map (``weaver_prompts.SKELETON_SECTIONS``) otherwise
   — exactly the historical hardcoded expectations;
3. ``[]`` for unknown/custom types with no schema (the check is a no-op).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from agents.loom.weaver_helpers import load_schema
from agents.loom.weaver_prompts import SKELETON_SECTIONS

if TYPE_CHECKING:
    from pathlib import Path

# Schema docs declare the note's sections inside a block headed by something
# like "## Expected Sections" or "## Required Sections".
_SECTIONS_HEADING_RE = re.compile(
    r"^(?P<marks>#{2,6})[ \t]+.*\bsections\b[^\n]*$",
    re.IGNORECASE | re.MULTILINE,
)
_HEADING_RE = re.compile(r"^(?P<marks>#{2,6})[ \t]+(?P<title>.+?)[ \t]*$")
# Backtick-quoted headings in list/prose lines: ``- `## Summary` — …``.
_TICKED_HEADING_RE = re.compile(r"`#{2,6}[ \t]+(?P<title>[^`]+?)`")
# Level-2 headings of a bare section template (e.g. SKELETON_SECTIONS).
_TEMPLATE_HEADING_RE = re.compile(r"^##[ \t]+(?P<title>.+?)[ \t]*$", re.MULTILINE)
_OPTIONAL_IN_TITLE_RE = re.compile(r"\boptional\b", re.IGNORECASE)
_OPTIONAL_LEAD_RE = re.compile(r"optional\b", re.IGNORECASE)
# Decoration that may precede an "optional" marker in a section description
# (space, tab, em/en dash, hyphen, colon, paren, backtick).
_LEADING_DECORATION = " \t—–-:(`"  # noqa: RUF001 — real em/en dashes intended


def _marked_optional(title: str, description: str) -> bool:
    """A declared section is optional when its title says so, or when its
    description *leads with* "optional" (e.g. "Optional. External sources…")."""
    if _OPTIONAL_IN_TITLE_RE.search(title):
        return True
    return bool(_OPTIONAL_LEAD_RE.match(description.lstrip(_LEADING_DECORATION)))


def _declared_sections(schema_text: str) -> list[str] | None:
    """Extract required section names from a schema doc's sections block.

    Handles the two declaration styles used by vault schemas: subheadings
    under the sections heading (``### Definition``) and backtick-quoted
    headings in list items (``- `## Summary` — …``). Optional sections are
    not required. Returns ``None`` when the doc has no sections heading at
    all (e.g. the schema is written as a bare section template).
    """
    match = _SECTIONS_HEADING_RE.search(schema_text)
    if match is None:
        return None
    block_level = len(match.group("marks"))
    lines = schema_text[match.end() :].splitlines()

    sections: list[str] = []
    idx = 0
    while idx < len(lines):
        line = lines[idx]
        heading = _HEADING_RE.match(line)
        if heading is not None:
            if len(heading.group("marks")) <= block_level:
                break  # a same-or-higher heading ends the sections block
            title = heading.group("title")
            # The subsection's first content line may mark it optional.
            body = idx + 1
            while body < len(lines) and not lines[body].strip():
                body += 1
            first = ""
            if body < len(lines) and _HEADING_RE.match(lines[body]) is None:
                first = lines[body]
            if _marked_optional(title, first):
                # Skip the optional subsection's prose entirely.
                idx = body
                while idx < len(lines) and _HEADING_RE.match(lines[idx]) is None:
                    idx += 1
                continue
            sections.append(title)
        else:
            for ticked in _TICKED_HEADING_RE.finditer(line):
                title = ticked.group("title").strip()
                if not _marked_optional(title, line[ticked.end() :]):
                    sections.append(title)
        idx += 1
    return sections


def _template_headings(text: str) -> list[str]:
    """Pull level-2 heading names out of a bare section template."""
    return [match.group("title") for match in _TEMPLATE_HEADING_RE.finditer(text)]


def expected_sections(vault_root: Path, note_type: str) -> list[str]:
    """Section names (without the ``## `` prefix) a note of ``note_type`` must carry.

    Prefers the vault's on-disk schema; falls back to the built-in skeleton
    map when no schema file exists, and to ``[]`` for unknown/custom types
    without one.
    """
    raw = load_schema(vault_root, note_type)
    if raw:
        declared = _declared_sections(raw)
        if declared is not None:
            return declared
        return _template_headings(raw)
    return _template_headings(SKELETON_SECTIONS.get(note_type, ""))


def skeleton_body(vault_root: Path, note_type: str) -> str:
    """Blank-section skeleton for a new note of ``note_type``.

    Follows the on-disk schema when present so notes Weaver creates already
    satisfy Sentinel's section check; otherwise returns the legacy built-in
    skeleton unchanged. Unknown types get an empty body, as before.
    """
    raw = load_schema(vault_root, note_type)
    if not raw:
        return SKELETON_SECTIONS.get(note_type, "")
    sections = expected_sections(vault_root, note_type)
    if not sections:
        return ""
    return "\n\n\n\n".join(f"## {s}" for s in sections) + "\n\n"

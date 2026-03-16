"""Parsers for vault rule files (schemas, policies, workflows).

Each parser reads a markdown file with optional YAML frontmatter and
extracts structured data into the corresponding Pydantic model.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from rules.models import PolicyRule, SchemaRule, WorkflowRule, WorkflowStep

if TYPE_CHECKING:
    from pathlib import Path

# -- Regex patterns -----------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_YAML_BLOCK_RE = re.compile(r"```yaml\s*\n(.*?)```", re.DOTALL)
_SECTION_ITEM_RE = re.compile(r"-\s*`(##\s+\S[^`]*)`")
_NUMBERED_RULE_RE = re.compile(r"^\d+\.\s+", re.MULTILINE)
_HEADING_NAME_RE = re.compile(r"^#\s+(Schema|Policy|Workflow):\s*(.+)", re.MULTILINE)
_BOLD_AGENT_RE = re.compile(r"\*\*(\w+)\*\*\s+(.*)")
_YAML_FIELD_VALUE_RE = re.compile(r"^(\w[\w_]*):\s*(.+)$", re.MULTILINE)

# Known YAML type indicators used in schema templates.
_TYPE_MAP: dict[str, str] = {
    "[]": "list",
    "ISO8601": "str",
    "active|archived": "str",
    "user|agent:<name>": "str",
}


def _extract_body(text: str) -> str:
    """Strip YAML frontmatter from *text*, returning the markdown body."""
    match = _FRONTMATTER_RE.match(text)
    if match:
        return text[match.end():]
    return text


def _get_section(body: str, heading: str) -> str:
    """Return the text under a ``## <heading>`` section.

    Captures everything from the heading line to the next ``##`` heading
    or end-of-string.
    """
    pattern = re.compile(
        rf"^##\s+{re.escape(heading)}\s*\n(.*?)(?=^##\s|\Z)",
        re.DOTALL | re.MULTILINE,
    )
    match = pattern.search(body)
    return match.group(1).strip() if match else ""


def _extract_heading_name(body: str, kind: str) -> str:
    """Extract the name from a ``# <Kind>: <Name>`` heading."""
    match = _HEADING_NAME_RE.search(body)
    if match and match.group(1).lower() == kind.lower():
        return match.group(2).strip()
    return ""


# -- Public parsers -----------------------------------------------------------


def parse_schema(path: Path) -> SchemaRule:
    """Parse a schema rule file into a ``SchemaRule``.

    Expects a markdown file with:
    - A ``# Schema: <type>`` heading
    - A ``## Required Frontmatter`` section containing a ```yaml code block
    - An optional ``## Expected Sections`` section with ``- `## Name` ...`` items

    Args:
        path: Path to the schema ``.md`` file.

    Returns:
        A populated ``SchemaRule`` instance.
    """
    text = path.read_text(encoding="utf-8")
    body = _extract_body(text)

    # Derive note_type from the heading or filename.
    note_type = _extract_heading_name(body, "Schema").lower() or path.stem

    # -- Required fields from the yaml code block -----------------------------
    required_fields: list[str] = []
    field_types: dict[str, str] = {}

    required_section = _get_section(body, "Required Frontmatter")
    yaml_match = _YAML_BLOCK_RE.search(required_section)
    if yaml_match:
        yaml_text = yaml_match.group(1)
        for fm in _YAML_FIELD_VALUE_RE.finditer(yaml_text):
            field_name = fm.group(1)
            raw_value = fm.group(2).strip()
            required_fields.append(field_name)
            # Infer a simple type hint from the value placeholder.
            if raw_value in _TYPE_MAP:
                field_types[field_name] = _TYPE_MAP[raw_value]
            elif raw_value.startswith("[") and raw_value.endswith("]"):
                field_types[field_name] = "list"
            else:
                field_types[field_name] = "str"

    # -- Expected sections ----------------------------------------------------
    sections: list[str] = []
    sections_text = _get_section(body, "Expected Sections")
    for m in _SECTION_ITEM_RE.finditer(sections_text):
        sections.append(m.group(1).strip())

    return SchemaRule(
        note_type=note_type,
        required_fields=required_fields,
        field_types=field_types,
        sections=sections,
        template=text,
    )


def parse_policy(path: Path) -> PolicyRule:
    """Parse a policy rule file into a ``PolicyRule``.

    Expects a markdown file with:
    - A ``# Policy: <Name>`` heading
    - A ``## Rules`` section containing numbered rules

    Args:
        path: Path to the policy ``.md`` file.

    Returns:
        A populated ``PolicyRule`` instance.
    """
    text = path.read_text(encoding="utf-8")
    body = _extract_body(text)

    name = _extract_heading_name(body, "Policy") or path.stem

    # Extract individual rules from the "## Rules" section.
    rules_text = _get_section(body, "Rules")
    conditions = _split_numbered_items(rules_text)

    # First paragraph after the heading (before ## Rules) serves as description.
    desc_match = re.search(
        r"^#\s+Policy:.*?\n\n(.+?)(?=\n##|\Z)", body, re.DOTALL
    )
    description = desc_match.group(1).strip() if desc_match else ""

    return PolicyRule(
        name=name,
        conditions=conditions,
        description=description,
    )


def parse_workflow(path: Path) -> WorkflowRule:
    """Parse a workflow rule file into a ``WorkflowRule``.

    Expects a markdown file with:
    - A ``# Workflow: <Name>`` heading
    - A ``## Steps`` section with numbered items where the agent name is **bold**
    - A ``## Trigger`` section with bullet-point triggers

    Args:
        path: Path to the workflow ``.md`` file.

    Returns:
        A populated ``WorkflowRule`` instance.
    """
    text = path.read_text(encoding="utf-8")
    body = _extract_body(text)

    name = _extract_heading_name(body, "Workflow") or path.stem

    # -- Steps ----------------------------------------------------------------
    steps_text = _get_section(body, "Steps")
    raw_steps = _split_numbered_items(steps_text)
    steps: list[WorkflowStep] = []
    prev_agent: str | None = None
    for raw in raw_steps:
        agent_match = _BOLD_AGENT_RE.search(raw)
        if agent_match:
            agent = agent_match.group(1).lower()
            action = agent_match.group(2).strip()
        else:
            # Fallback: treat the whole line as the action with unknown agent.
            agent = "unknown"
            action = raw.strip()
        steps.append(WorkflowStep(
            agent=agent,
            action=action,
            input_from=prev_agent,
        ))
        prev_agent = agent

    # -- Trigger --------------------------------------------------------------
    trigger_text = _get_section(body, "Trigger")
    trigger_lines = [
        line.lstrip("- ").strip()
        for line in trigger_text.splitlines()
        if line.strip().startswith("-")
    ]
    trigger = "; ".join(trigger_lines) if trigger_lines else ""

    return WorkflowRule(name=name, trigger=trigger, steps=steps)


# -- Helpers ------------------------------------------------------------------


def _split_numbered_items(text: str) -> list[str]:
    """Split a block of numbered markdown items into individual strings.

    Given text like:
        1. First rule about ...
           continuation line.
        2. Second rule ...

    Returns ``["First rule about ... continuation line.", "Second rule ..."]``.
    """
    if not text.strip():
        return []

    parts = _NUMBERED_RULE_RE.split(text)
    # The first element is whatever precedes the first numbered item (usually empty).
    items: list[str] = []
    for part in parts:
        cleaned = " ".join(part.split())
        if cleaned:
            items.append(cleaned)
    return items

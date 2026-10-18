"""Commit messages, trailers, and attribution for vault history.

Subject: ``<agent>: <action> <path>`` (``(+N more)`` for grouped runs).
Trailers: ``Agent`` (one per distinct writer), ``Action``, ``Reason``,
``Sentinel``, and Loom's own ``Loom-Run`` / ``Loom-Group`` / ``Reverts``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml

from core.history.git import Identity

HUMAN = "human"
NOT_REVIEWED = "not-reviewed"
_MAX_TRAILER = 240
_MAX_BODY_FILES = 200
_TRAILER_RE = re.compile(r"^([A-Za-z][A-Za-z-]*): (.*)$")
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class FileChange:
    """One path a commit touches, with who changed it and how."""

    path: str
    agent: str
    action: str
    reason: str = ""


@dataclass
class CommitSpec:
    """Everything needed to render one commit message."""

    changes: list[FileChange]
    action: str = ""
    reason: str = ""
    sentinel: str = NOT_REVIEWED
    run_id: str = ""
    group_id: str = ""
    reverts: str = ""
    subject: str = ""
    preamble: str = ""
    agents: list[str] = field(default_factory=list)


def one_line(value: str, limit: int = _MAX_TRAILER) -> str:
    """Collapse whitespace so a value is safe inside a subject or trailer."""
    flat = " ".join(str(value).split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def identity_for(agent: str) -> Identity:
    """Author identity for a writer (``.invalid`` never resolves)."""
    slug = _SAFE_NAME_RE.sub("-", agent).strip("-") or "loom"
    return Identity(name=agent or "loom", email=f"{slug}@loom.invalid")


def normalize_agent(caller: str) -> str:
    """Map a trace caller label to a history writer name."""
    label = (caller or "").strip()
    if not label or label == "user" or label.startswith("user:"):
        return HUMAN
    for prefix in ("manual:", "agent:"):
        if label.startswith(prefix):
            label = label[len(prefix) :]
    return label or HUMAN


def explicit_human_action(caller: str) -> str:
    """``user:restore`` → ``restore``; empty for plain human edits."""
    label = (caller or "").strip()
    return label.split(":", 1)[1] if label.startswith("user:") else ""


def _last_history(text: str | None) -> dict[str, str]:
    if not text or not text.startswith("---"):
        return {}
    try:
        meta = yaml.safe_load(text.split("---", 2)[1])
    except (yaml.YAMLError, IndexError):
        return {}
    history = meta.get("history") if isinstance(meta, dict) else None
    if not isinstance(history, list) or not history or not isinstance(history[-1], dict):
        return {}
    return {k: str(v) for k, v in history[-1].items() if v is not None}


def writer_from_content(before: str | None, after: str | None) -> str:
    """Attribute a write by the ``by`` of a history entry it added, if any."""
    entry = _last_history(after)
    if not entry or entry == _last_history(before):
        return ""
    by = entry.get("by", "")
    if not by:
        return ""
    return HUMAN if by == "user" else normalize_agent(by)


def infer_change(before: str | None, after: str | None) -> tuple[str, str]:
    """Derive ``(action, reason)`` from a note's new history entry or its existence."""
    entry = _last_history(after)
    if entry and entry != _last_history(before) and entry.get("action"):
        return entry["action"], entry.get("reason", "")
    if before is None:
        return "created", ""
    if after is None:
        return "deleted", ""
    return "updated", ""


def build_message(spec: CommitSpec) -> str:
    """Render the subject, file list, and trailer block for a commit."""
    changes = spec.changes
    first = changes[0] if changes else FileChange(path="", agent=HUMAN, action="edited")
    agents = spec.agents or list(dict.fromkeys(c.agent for c in changes)) or [first.agent]
    action = spec.action or first.action
    subject = spec.subject or f"{agents[0]}: {action} {first.path}".rstrip()
    if not spec.subject and len(changes) > 1:
        subject += f" (+{len(changes) - 1} more)"
    lines = [one_line(subject, 200), ""]
    if spec.preamble:
        lines += [spec.preamble, ""]
    if len(changes) > 1:
        lines.append("Files:")
        lines += [f"- {c.agent}: {c.action} {c.path}" for c in changes[:_MAX_BODY_FILES]]
        if len(changes) > _MAX_BODY_FILES:
            lines.append(f"- … and {len(changes) - _MAX_BODY_FILES} more")
        lines.append("")
    lines += [f"Agent: {one_line(agent, 80)}" for agent in agents]
    lines.append(f"Action: {one_line(action, 80)}")
    reason = spec.reason or first.reason
    if reason:
        lines.append(f"Reason: {one_line(reason)}")
    lines.append(f"Sentinel: {one_line(spec.sentinel or NOT_REVIEWED, 80)}")
    if spec.reverts:
        lines.append(f"Reverts: {spec.reverts}")
    if spec.run_id:
        lines.append(f"Loom-Run: {one_line(spec.run_id, 80)}")
    if spec.group_id:
        lines.append(f"Loom-Group: {spec.group_id}")
    return "\n".join(lines) + "\n"


def parse_trailers(message: str) -> dict[str, list[str]]:
    """Read the trailer block (the message's final paragraph)."""
    paragraphs = [p for p in message.strip().split("\n\n") if p.strip()]
    trailers: dict[str, list[str]] = {}
    if len(paragraphs) < 2:
        return trailers
    for line in paragraphs[-1].splitlines():
        match = _TRAILER_RE.match(line.strip())
        if match:
            trailers.setdefault(match.group(1), []).append(match.group(2))
    return trailers

"""Changelog logger: append structured entries to per-agent daily changelogs.

Entries are written to ``.loom/changelog/<agent>/<YYYY-MM-DD>.md`` and also
to the agent's own ``logs/`` folder.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from core.notes import now_iso

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)


def _today_str() -> str:
    """Return today's date as YYYY-MM-DD."""
    return now_iso()[:10]


def _format_entry(
    agent_name: str,
    action: str,
    target: str,
    details: str,
    chain_status: str,
    timestamp: str,
) -> str:
    """Format a single changelog entry."""
    lines = [
        f"## {timestamp}",
        "",
        f"- **Agent:** {agent_name}",
        f"- **Action:** {action}",
        f"- **Target:** {target}",
        f"- **Chain:** {chain_status}",
    ]
    if details:
        lines.append(f"- **Details:** {details}")
    lines.append("")
    return "\n".join(lines)


def log_action(
    vault_root: Path,
    agent_name: str,
    action: str,
    target: str,
    details: str = "",
    chain_status: str = "pass",
) -> None:
    """Append an action entry to the agent's changelog and log file.

    Writes to two locations:
      1. ``.loom/changelog/<agent>/<date>.md`` — vault-wide audit trail
      2. ``agents/<agent>/logs/<date>.md`` — per-agent log

    Args:
        vault_root: Root path of the active vault.
        agent_name: Name of the acting agent.
        action: What was done (e.g. ``"created"``, ``"linked"``, ``"archived"``).
        target: Path or identifier of the affected note.
        details: Free-text description of what happened.
        chain_status: ``"pass"``, ``"warn"``, or ``"fail"``.
    """
    timestamp = now_iso()
    date_str = _today_str()

    entry = _format_entry(agent_name, action, target, details, chain_status, timestamp)

    # 1. Write to .loom/changelog/<agent>/<date>.md
    changelog_dir = vault_root / ".loom" / "changelog" / agent_name
    changelog_dir.mkdir(parents=True, exist_ok=True)
    changelog_path = changelog_dir / f"{date_str}.md"
    _append_to_file(changelog_path, entry, date_str)

    # 2. Write to agents/<agent>/logs/<date>.md
    logs_dir = vault_root / "agents" / agent_name / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / f"{date_str}.md"
    _append_to_file(log_path, entry, date_str)

    logger.debug("Logged action: %s/%s → %s", agent_name, action, target)


def _append_to_file(path: Path, entry: str, date_str: str) -> None:
    """Append an entry to a log file, creating a header if new."""
    if not path.exists():
        header = f"# Changelog — {date_str}\n\n"
        path.write_text(header + entry, encoding="utf-8")
    else:
        with path.open("a", encoding="utf-8") as f:
            f.write(entry)

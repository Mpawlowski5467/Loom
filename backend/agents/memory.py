"""Agent memory summarization: compress recent logs into memory.md.

When an agent hits its memory_threshold (default 20 actions), this module
reads recent log entries, summarizes them via the chat provider, and
writes a structured memory.md file.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from core.notes import now_iso

if TYPE_CHECKING:
    from pathlib import Path

    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

_SUMMARIZE_SYSTEM = """\
You are a memory summarizer for an AI agent in a knowledge management system.
Given the agent's recent action logs, produce a concise memory summary that
captures:

1. **Patterns** — recurring actions or targets
2. **Frequent targets** — notes or folders the agent interacts with most
3. **Learned preferences** — any adjustments or corrections observed
4. **Recent highlights** — important actions from the latest period

Format the output as a markdown document with ## headers for each section.
Keep it under 500 words. Preserve any [[wikilinks]] from the source material.
"""


async def summarize_memory(
    vault_root: Path,
    agent_name: str,
    chat_provider: BaseProvider,
) -> str:
    """Read recent logs, summarize via chat, and update memory.md.

    Args:
        vault_root: Root path of the active vault.
        agent_name: Name of the agent whose memory to summarize.
        chat_provider: The chat LLM provider for summarization.

    Returns:
        The generated summary text.
    """
    # Collect recent log entries
    logs_dir = vault_root / "agents" / agent_name / "logs"
    log_text = _collect_recent_logs(logs_dir)

    if not log_text.strip():
        logger.info("No logs to summarize for agent %s", agent_name)
        return ""

    # Read existing memory for context
    memory_path = vault_root / "agents" / agent_name / "memory.md"
    existing_memory = ""
    if memory_path.exists():
        existing_memory = memory_path.read_text(encoding="utf-8")

    # Build the prompt
    user_message = (
        f"Agent: {agent_name}\n\n"
        f"## Existing Memory\n\n{existing_memory}\n\n"
        f"## Recent Logs\n\n{log_text}\n\n"
        "Produce an updated memory summary that merges the existing memory "
        "with insights from the recent logs."
    )

    # Summarize via chat provider
    summary = await chat_provider.chat(
        messages=[{"role": "user", "content": user_message}],
        system=_SUMMARIZE_SYSTEM,
    )

    # Write updated memory.md
    timestamp = now_iso()
    memory_content = f"# Memory\n\n*Last summarized: {timestamp}*\n\n{summary}\n"
    memory_path.write_text(memory_content, encoding="utf-8")
    logger.info("Updated memory.md for agent %s", agent_name)
    return summary


def _collect_recent_logs(logs_dir: Path, max_files: int = 5) -> str:
    """Read the most recent log files and concatenate their content.

    Args:
        logs_dir: Directory containing daily log files.
        max_files: Maximum number of log files to read (most recent first).

    Returns:
        Concatenated log text.
    """
    if not logs_dir.exists():
        return ""

    log_files = sorted(logs_dir.glob("*.md"), reverse=True)[:max_files]
    parts: list[str] = []
    for lf in log_files:
        try:
            parts.append(lf.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
    return "\n\n".join(parts)

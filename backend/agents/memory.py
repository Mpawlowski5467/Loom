"""Agent memory summarization: compress recent logs into memory.md.

When an agent hits its memory cadence (default 20 actions), this module
reads recent log entries and existing memory, builds a summarization prompt,
and produces a condensed memory.md that:

- Replaces older content with an LLM summary
- Preserves the most recent raw entries verbatim (recency matters)
- Retains all [[wikilinks]] and key facts
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import TYPE_CHECKING

from agents.changelog import log_action
from core.notes import now_iso

if TYPE_CHECKING:
    from pathlib import Path

    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

RECENT_ENTRIES_TO_KEEP = 5

# Stale-lock threshold: if a .lock file is older than this, assume the
# process that wrote it died and reclaim the lock. Summarization itself
# takes seconds; 5 minutes is generous.
_STALE_LOCK_SECONDS = 300

# Per-agent asyncio locks, keyed by (vault_root_str, agent_name). Prevents
# two coroutines in the same process from running summarize_memory against
# the same agent concurrently. A file lock on disk handles the cross-process
# case.
_ASYNC_LOCKS: dict[tuple[str, str], asyncio.Lock] = {}


def _get_async_lock(vault_root: Path, agent_name: str) -> asyncio.Lock:
    key = (str(vault_root), agent_name)
    lock = _ASYNC_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _ASYNC_LOCKS[key] = lock
    return lock

# -- Entry boundary pattern: each entry starts with "## <ISO timestamp>" -----
_ENTRY_RE = re.compile(r"(?=^## \d{4}-\d{2}-\d{2}T)", re.MULTILINE)

# -- Memory summarization system prompt ---------------------------------------
_SYSTEM_PROMPT = """\
You are a memory summarizer for an AI agent in a knowledge management system.
Given the agent's existing memory and recent action logs, produce a condensed
summary that captures:

1. **Patterns** -- recurring actions, frequent targets, typical workflows
2. **Key facts** -- important note IDs, folder paths, relationships discovered
3. **Learned preferences** -- corrections, adjustments, user feedback observed
4. **Recent highlights** -- the most important actions from the latest period

Rules:
- Keep all [[wikilinks]] exactly as they appear.
- Preserve note IDs (thr_XXXXXX) and file paths.
- Use ## headers for each section.
- Stay under 500 words.
- Do NOT include the raw log entries — only the distilled knowledge.
"""


async def summarize_memory(
    vault_root: Path,
    agent_name: str,
    chat_provider: BaseProvider,
) -> str:
    """Read recent logs, summarize via chat, and update memory.md.

    Serialized per (vault, agent) by an asyncio lock (intra-process) and a
    file lock (cross-process). If another caller is already summarizing,
    this call waits and then returns an empty string — the other call's
    write is authoritative.

    The new memory.md has two sections:
    1. An LLM-generated summary of older content (condensed)
    2. The most recent raw entries preserved verbatim

    Args:
        vault_root: Root path of the active vault.
        agent_name: Name of the agent whose memory to summarize.
        chat_provider: The chat LLM provider for summarization.

    Returns:
        The generated summary text, or "" if a concurrent summarization
        handled this round.
    """
    async with _get_async_lock(vault_root, agent_name):
        lock_path = vault_root / "agents" / agent_name / "memory.md.lock"
        if not _acquire_file_lock(lock_path):
            logger.info(
                "Another process is summarizing memory for %s; skipping",
                agent_name,
            )
            return ""
        try:
            return await _summarize_memory_inner(
                vault_root, agent_name, chat_provider
            )
        finally:
            _release_file_lock(lock_path)


async def _summarize_memory_inner(
    vault_root: Path,
    agent_name: str,
    chat_provider: BaseProvider,
) -> str:
    """Actual summarization work, run under the locks held by summarize_memory."""
    # Collect recent log entries
    logs_dir = vault_root / "agents" / agent_name / "logs"
    log_text = _collect_recent_logs(logs_dir)

    if not log_text.strip():
        logger.info("No logs to summarize for agent %s", agent_name)
        return ""

    # Read existing memory and split into summary vs raw entries
    memory_path = vault_root / "agents" / agent_name / "memory.md"
    existing_summary, existing_raw = _parse_memory(memory_path)

    # Combine all raw material: existing raw entries + new logs
    all_raw = (existing_raw + "\n\n" + log_text).strip()
    raw_entries = _split_entries(all_raw)

    # Separate: entries to summarize vs entries to keep verbatim
    if len(raw_entries) > RECENT_ENTRIES_TO_KEEP:
        entries_to_summarize = raw_entries[:-RECENT_ENTRIES_TO_KEEP]
        entries_to_keep = raw_entries[-RECENT_ENTRIES_TO_KEEP:]
    else:
        # Not enough entries to warrant summarization of old content;
        # just keep everything as raw
        entries_to_keep = raw_entries
        entries_to_summarize = []

    # Build the content to summarize: existing summary + older entries
    content_to_summarize = existing_summary
    if entries_to_summarize:
        content_to_summarize += "\n\n## Raw Entries to Condense\n\n" + "\n\n".join(
            entries_to_summarize
        )

    if not content_to_summarize.strip():
        # Nothing to summarize yet — just write raw entries as-is
        _write_memory(memory_path, "", entries_to_keep)
        return ""

    # Build the prompt
    system_prompt = _SYSTEM_PROMPT
    user_message = (
        f"Agent: {agent_name}\n\n"
        f"## Content to Summarize\n\n{content_to_summarize}\n\n"
        "Produce a condensed summary that merges and distills the above. "
        "Preserve all [[wikilinks]] and note IDs."
    )

    # Call chat provider
    summary = await chat_provider.chat(
        messages=[{"role": "user", "content": user_message}],
        system=system_prompt,
    )

    # Write updated memory.md
    _write_memory(memory_path, summary, entries_to_keep)

    # Log the summarization action to changelog
    entry_count = len(entries_to_summarize)
    log_action(
        vault_root,
        agent_name,
        "summarized",
        f"agents/{agent_name}/memory.md",
        details=(
            f"Condensed {entry_count} older entries into summary, "
            f"kept {len(entries_to_keep)} recent entries verbatim"
        ),
        chain_status="pass",
    )

    logger.info("Updated memory.md for agent %s", agent_name)
    return summary


def _parse_memory(memory_path: Path) -> tuple[str, str]:
    """Parse memory.md into (summary_section, raw_entries_section).

    The file format is:
        # Memory
        *Last summarized: ...*
        <summary content>
        ---
        ## Recent Activity
        <raw entries>

    Returns:
        Tuple of (summary_text, raw_entries_text). Either may be empty.
    """
    if not memory_path.exists():
        return "", ""

    text = memory_path.read_text(encoding="utf-8")

    # Split on the "---" separator between summary and recent entries
    separator = "\n---\n"
    if separator in text:
        parts = text.split(separator, 1)
        summary_part = parts[0]
        raw_part = parts[1]
        # Strip the "## Recent Activity" header if present
        raw_part = re.sub(r"^## Recent Activity\s*\n", "", raw_part.strip())
    else:
        # No separator — treat the whole thing as summary (legacy format)
        summary_part = text
        raw_part = ""

    # Strip the "# Memory" header and "Last summarized" line from summary
    summary_part = re.sub(r"^# Memory\s*\n", "", summary_part.strip())
    summary_part = re.sub(r"^\*Last summarized:.*?\*\s*\n?", "", summary_part.strip())

    return summary_part.strip(), raw_part.strip()


def _split_entries(text: str) -> list[str]:
    """Split log/entry text into individual entries by ## timestamp headers."""
    if not text.strip():
        return []

    parts = _ENTRY_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


def _write_memory(
    memory_path: Path,
    summary: str,
    recent_entries: list[str],
) -> None:
    """Write the updated memory.md with summary + recent entries."""
    timestamp = now_iso()
    lines = [f"# Memory\n\n*Last summarized: {timestamp}*\n"]

    if summary.strip():
        lines.append(f"\n{summary.strip()}\n")

    if recent_entries:
        lines.append("\n---\n\n## Recent Activity\n")
        for entry in recent_entries:
            lines.append(f"\n{entry.strip()}\n")

    memory_path.write_text("\n".join(lines), encoding="utf-8")


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
        except (OSError, ValueError):
            continue
    return "\n\n".join(parts)


def _acquire_file_lock(lock_path: Path) -> bool:
    """Try to create lock_path exclusively. Returns True on success.

    If an existing lock is older than _STALE_LOCK_SECONDS, we assume the
    writer died and reclaim it.
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # O_EXCL means "fail if it exists" — atomic on POSIX filesystems.
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, f"{os.getpid()}\n".encode())
        os.close(fd)
        return True
    except FileExistsError:
        # Existing lock — check if it's stale.
        try:
            age = time.time() - lock_path.stat().st_mtime
        except OSError:
            return False
        if age > _STALE_LOCK_SECONDS:
            logger.warning(
                "Reclaiming stale memory lock at %s (age %.0fs)",
                lock_path,
                age,
            )
            try:
                lock_path.unlink()
            except OSError:
                return False
            return _acquire_file_lock(lock_path)
        return False
    except OSError:
        return False


def _release_file_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink()
    except OSError:
        # Lock might have been removed by stale reclaim from another process;
        # nothing to do.
        pass

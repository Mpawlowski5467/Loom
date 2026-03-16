"""Chat persistence: save and load conversation history for agents.

Storage layout:
  - Shuttle agents (1:1 chat): ``agents/<name>/chat/<YYYY-MM-DD>.md``
  - Loom Council (multi-agent): ``agents/_council/chat/<YYYY-MM-DD>.md``

Message format in markdown::

    ### user — 2026-03-15T10:30:00+00:00
    What is caching?

    ### assistant — 2026-03-15T10:30:05+00:00
    Caching is a technique for storing ...
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from core.notes import now_iso

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_MSG_HEADER_RE = re.compile(
    r"^### (user|assistant|council|agent:\w+)\s*—\s*(\S+)\s*$", re.MULTILINE
)

COUNCIL_AGENT = "_council"


@dataclass
class ChatMessage:
    """A single chat message."""

    role: str  # "user", "assistant", or "agent:<name>"
    content: str
    timestamp: str
    agent: str = ""  # which agent session this belongs to

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "agent": self.agent,
        }

    def to_llm_message(self) -> dict:
        """Convert to the format expected by BaseProvider.chat()."""
        llm_role = "user" if self.role == "user" else "assistant"
        return {"role": llm_role, "content": self.content}


def _format_message(role: str, content: str, timestamp: str) -> str:
    """Format a single message as markdown."""
    return f"### {role} — {timestamp}\n\n{content}\n\n"


def _today_str() -> str:
    return now_iso()[:10]


class ChatHistory:
    """Manages chat persistence for agents and the Loom Council."""

    def __init__(self, vault_root: Path) -> None:
        self._vault_root = vault_root

    def _chat_dir(self, agent: str) -> Path:
        """Return the chat directory for an agent or _council."""
        if agent == COUNCIL_AGENT:
            return self._vault_root / "agents" / "_council" / "chat"
        return self._vault_root / "agents" / agent / "chat"

    def _chat_file(self, agent: str, date_str: str | None = None) -> Path:
        """Return the chat file path for a given agent and date."""
        date_str = date_str or _today_str()
        chat_dir = self._chat_dir(agent)
        chat_dir.mkdir(parents=True, exist_ok=True)
        return chat_dir / f"{date_str}.md"

    def save_message(
        self,
        agent: str,
        role: str,
        content: str,
        timestamp: str | None = None,
    ) -> ChatMessage:
        """Append a message to the agent's chat history.

        Args:
            agent: Agent name (e.g. ``"researcher"``) or ``"_council"``.
            role: ``"user"``, ``"assistant"``, or ``"agent:<name>"``.
            content: Message text.
            timestamp: ISO-8601 timestamp. Defaults to now.

        Returns:
            The saved ChatMessage.
        """
        timestamp = timestamp or now_iso()
        path = self._chat_file(agent)

        entry = _format_message(role, content, timestamp)

        if not path.exists():
            header = f"# Chat — {agent} — {_today_str()}\n\n"
            path.write_text(header + entry, encoding="utf-8")
        else:
            with path.open("a", encoding="utf-8") as f:
                f.write(entry)

        msg = ChatMessage(role=role, content=content, timestamp=timestamp, agent=agent)
        logger.debug("Chat message saved: %s/%s at %s", agent, role, timestamp)
        return msg

    def load_recent(
        self,
        agent: str,
        limit: int = 20,
    ) -> list[ChatMessage]:
        """Load the most recent messages for an agent.

        Reads from the most recent chat files (today first, then backwards)
        until ``limit`` messages are collected.

        Args:
            agent: Agent name or ``"_council"``.
            limit: Maximum number of messages to return.

        Returns:
            List of ChatMessage in chronological order (oldest first).
        """
        chat_dir = self._chat_dir(agent)
        if not chat_dir.exists():
            return []

        # Collect from most recent files first
        chat_files = sorted(chat_dir.glob("*.md"), reverse=True)
        all_messages: list[ChatMessage] = []

        for chat_file in chat_files:
            try:
                messages = self._parse_chat_file(chat_file, agent)
                all_messages = messages + all_messages
                if len(all_messages) >= limit:
                    break
            except Exception:  # noqa: BLE001
                logger.debug("Failed to parse chat file %s", chat_file, exc_info=True)

        # Return the last `limit` messages in chronological order
        return all_messages[-limit:]

    def load_day(self, agent: str, date_str: str) -> list[ChatMessage]:
        """Load all messages for a specific day."""
        path = self._chat_file(agent, date_str)
        if not path.exists():
            return []
        return self._parse_chat_file(path, agent)

    def list_sessions(self, agent: str) -> list[str]:
        """List available chat session dates for an agent."""
        chat_dir = self._chat_dir(agent)
        if not chat_dir.exists():
            return []
        return sorted(f.stem for f in chat_dir.glob("*.md"))

    @staticmethod
    def _parse_chat_file(path: Path, agent: str) -> list[ChatMessage]:
        """Parse a chat markdown file into ChatMessage objects."""
        text = path.read_text(encoding="utf-8")
        messages: list[ChatMessage] = []

        matches = list(_MSG_HEADER_RE.finditer(text))
        for i, match in enumerate(matches):
            role = match.group(1)
            timestamp = match.group(2)
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            content = text[start:end].strip()

            messages.append(
                ChatMessage(
                    role=role,
                    content=content,
                    timestamp=timestamp,
                    agent=agent,
                )
            )

        return messages


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_chat_history: ChatHistory | None = None


def get_chat_history() -> ChatHistory | None:
    """Return the global ChatHistory, or None if not initialized."""
    return _chat_history


def init_chat_history(vault_root: Path) -> ChatHistory:
    """Create and cache the global ChatHistory."""
    global _chat_history
    _chat_history = ChatHistory(vault_root)
    return _chat_history

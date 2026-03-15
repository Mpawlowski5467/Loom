"""Tests for agents/memory.py — agent memory summarization."""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from agents.memory import summarize_memory


def _setup_agent(tmp_path: Path) -> Path:
    """Create agent directory with logs."""
    root = tmp_path / "vault"
    agent_dir = root / "agents" / "weaver"
    logs_dir = agent_dir / "logs"
    logs_dir.mkdir(parents=True)

    # Write some log files
    (logs_dir / "2026-03-13.md").write_text(
        "# Changelog — 2026-03-13\n\n"
        "## 2026-03-13T10:00:00+00:00\n\n"
        "- **Agent:** weaver\n"
        "- **Action:** created\n"
        "- **Target:** threads/topics/alpha.md\n\n",
        encoding="utf-8",
    )
    (logs_dir / "2026-03-14.md").write_text(
        "# Changelog — 2026-03-14\n\n"
        "## 2026-03-14T09:00:00+00:00\n\n"
        "- **Agent:** weaver\n"
        "- **Action:** linked\n"
        "- **Target:** thr_abc123\n\n",
        encoding="utf-8",
    )

    # Existing memory.md
    (agent_dir / "memory.md").write_text(
        "# Memory\n\nI have created notes before.\n", encoding="utf-8"
    )

    return root


class TestSummarizeMemory:
    @pytest.mark.asyncio
    async def test_summarizes_and_writes_memory(self, tmp_path: Path):
        root = _setup_agent(tmp_path)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(
            return_value="## Patterns\n\nFrequently creates topic notes.\n"
        )

        result = await summarize_memory(root, "weaver", chat_mock)

        assert "Patterns" in result
        assert chat_mock.chat.called

        # Verify the prompt sent to chat
        call_args = chat_mock.chat.call_args
        user_msg = call_args.kwargs.get("messages", call_args.args[0] if call_args.args else [])[0][
            "content"
        ]
        assert "weaver" in user_msg
        assert "Existing Memory" in user_msg
        assert "Recent Logs" in user_msg

        # Verify memory.md was written
        memory_path = root / "agents" / "weaver" / "memory.md"
        memory = memory_path.read_text(encoding="utf-8")
        assert "# Memory" in memory
        assert "Last summarized" in memory
        assert "Patterns" in memory

    @pytest.mark.asyncio
    async def test_no_logs_returns_empty(self, tmp_path: Path):
        root = tmp_path / "vault"
        agent_dir = root / "agents" / "weaver"
        agent_dir.mkdir(parents=True)
        (agent_dir / "memory.md").write_text("# Memory\n", encoding="utf-8")
        # No logs directory

        chat_mock = AsyncMock()
        result = await summarize_memory(root, "weaver", chat_mock)

        assert result == ""
        assert not chat_mock.chat.called

    @pytest.mark.asyncio
    async def test_reads_most_recent_logs(self, tmp_path: Path):
        root = _setup_agent(tmp_path)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="Summary.")

        await summarize_memory(root, "weaver", chat_mock)

        # Both log files should be included in the prompt
        call_kwargs = chat_mock.chat.call_args.kwargs
        call_args = chat_mock.chat.call_args.args
        messages = call_kwargs.get("messages") or call_args[0]
        user_msg = messages[0]["content"]
        assert "2026-03-14" in user_msg
        assert "2026-03-13" in user_msg

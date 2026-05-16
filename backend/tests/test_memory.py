"""Tests for agents/memory.py — agent memory summarization."""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from agents.memory import (
    _parse_memory,
    _split_entries,
    _write_memory,
    summarize_memory,
)


def _make_entry(date: str, time: str, action: str, target: str) -> str:
    """Build a single changelog-style entry."""
    return (
        f"## {date}T{time}+00:00\n\n"
        f"- **Agent:** weaver\n"
        f"- **Action:** {action}\n"
        f"- **Target:** {target}\n"
    )


def _setup_agent(tmp_path: Path, *, num_entries: int = 8) -> Path:
    """Create agent directory with logs containing multiple entries."""
    root = tmp_path / "vault"
    agent_dir = root / "agents" / "weaver"
    logs_dir = agent_dir / "logs"
    logs_dir.mkdir(parents=True)

    # Generate enough entries to trigger summarization
    entries_day1 = []
    for i in range(min(num_entries, 4)):
        entries_day1.append(
            _make_entry("2026-03-13", f"{10 + i}:00:00", "created", f"threads/topics/note-{i}.md")
        )
    (logs_dir / "2026-03-13.md").write_text(
        "# Changelog — 2026-03-13\n\n" + "\n\n".join(entries_day1),
        encoding="utf-8",
    )

    if num_entries > 4:
        entries_day2 = []
        for i in range(4, num_entries):
            entries_day2.append(
                _make_entry("2026-03-14", f"{9 + i - 4}:00:00", "linked", f"thr_abc{i:03d}")
            )
        (logs_dir / "2026-03-14.md").write_text(
            "# Changelog — 2026-03-14\n\n" + "\n\n".join(entries_day2),
            encoding="utf-8",
        )

    return root


class TestSummarizeMemory:
    @pytest.mark.asyncio
    async def test_summarizes_and_writes_memory(self, tmp_path: Path):
        root = _setup_agent(tmp_path, num_entries=8)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="## Patterns\n\nFrequently creates topic notes.\n")

        result = await summarize_memory(root, "weaver", chat_mock)

        assert "Patterns" in result
        assert chat_mock.chat.called

        # Verify the prompt sent to chat mentions the agent
        call_kwargs = chat_mock.chat.call_args.kwargs
        user_msg = call_kwargs["messages"][0]["content"]
        assert "weaver" in user_msg
        assert "Content to Summarize" in user_msg

        # Verify memory.md was written with both summary and recent entries
        memory_path = root / "agents" / "weaver" / "memory.md"
        memory = memory_path.read_text(encoding="utf-8")
        assert "# Memory" in memory
        assert "Last summarized" in memory
        assert "Patterns" in memory

    @pytest.mark.asyncio
    async def test_preserves_recent_entries_verbatim(self, tmp_path: Path):
        root = _setup_agent(tmp_path, num_entries=8)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="## Summary\n\nCondensed content.\n")

        await summarize_memory(root, "weaver", chat_mock)

        memory_path = root / "agents" / "weaver" / "memory.md"
        memory = memory_path.read_text(encoding="utf-8")

        # Should have the separator and Recent Activity section
        assert "---" in memory
        assert "## Recent Activity" in memory

        # Recent entries should be preserved verbatim (the last 5 entries)
        # With 8 entries total, the last 5 should be kept raw
        assert "**Action:**" in memory

    @pytest.mark.asyncio
    async def test_no_logs_returns_empty(self, tmp_path: Path):
        root = tmp_path / "vault"
        agent_dir = root / "agents" / "weaver"
        agent_dir.mkdir(parents=True)
        (agent_dir / "memory.md").write_text("# Memory\n", encoding="utf-8")

        chat_mock = AsyncMock()
        result = await summarize_memory(root, "weaver", chat_mock)

        assert result == ""
        assert not chat_mock.chat.called

    @pytest.mark.asyncio
    async def test_few_entries_kept_raw_without_llm(self, tmp_path: Path):
        """When there are <= RECENT_ENTRIES_TO_KEEP entries, no LLM call needed."""
        root = _setup_agent(tmp_path, num_entries=3)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="Summary")

        await summarize_memory(root, "weaver", chat_mock)

        # With only 3 entries (< 5), no summarization of old content needed
        # The LLM should not be called since there's nothing to condense
        assert not chat_mock.chat.called

        # But memory.md should still be updated with the raw entries
        memory_path = root / "agents" / "weaver" / "memory.md"
        assert memory_path.exists()

    @pytest.mark.asyncio
    async def test_logs_summarization_to_changelog(self, tmp_path: Path):
        root = _setup_agent(tmp_path, num_entries=8)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="## Summary\n\nDone.\n")

        with patch("agents.memory.log_action") as mock_log:
            await summarize_memory(root, "weaver", chat_mock)

            mock_log.assert_called_once()
            call_kwargs = mock_log.call_args
            assert call_kwargs.args[0] == root  # vault_root
            assert call_kwargs.args[1] == "weaver"  # agent_name
            assert call_kwargs.args[2] == "summarized"  # action
            assert "memory.md" in call_kwargs.args[3]  # target

    @pytest.mark.asyncio
    async def test_reads_most_recent_logs(self, tmp_path: Path):
        root = _setup_agent(tmp_path, num_entries=8)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="Summary.")

        await summarize_memory(root, "weaver", chat_mock)

        # Both log dates should contribute entries
        call_kwargs = chat_mock.chat.call_args.kwargs
        user_msg = call_kwargs["messages"][0]["content"]
        assert "2026-03-14" in user_msg or "2026-03-13" in user_msg

    @pytest.mark.asyncio
    async def test_preserves_existing_summary(self, tmp_path: Path):
        """When re-summarizing, existing summary content is fed to the LLM."""
        root = _setup_agent(tmp_path, num_entries=8)
        memory_path = root / "agents" / "weaver" / "memory.md"

        # Write an existing memory with summary section
        memory_path.write_text(
            "# Memory\n\n*Last summarized: 2026-03-12T00:00:00+00:00*\n\n"
            "## Patterns\n\nPreviously created [[graph-databases]] note.\n\n"
            "---\n\n## Recent Activity\n\n"
            + _make_entry("2026-03-12", "15:00:00", "created", "threads/topics/old.md"),
            encoding="utf-8",
        )

        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(return_value="## Updated Patterns\n\nNew summary.\n")

        await summarize_memory(root, "weaver", chat_mock)

        # The existing summary should have been included in the prompt
        call_kwargs = chat_mock.chat.call_args.kwargs
        user_msg = call_kwargs["messages"][0]["content"]
        assert "graph-databases" in user_msg


class TestParseMemory:
    def test_empty_file(self, tmp_path: Path):
        path = tmp_path / "memory.md"
        summary, raw = _parse_memory(path)
        assert summary == ""
        assert raw == ""

    def test_legacy_format_no_separator(self, tmp_path: Path):
        path = tmp_path / "memory.md"
        path.write_text(
            "# Memory\n\n*Last summarized: 2026-03-12*\n\n## Patterns\n\nSome content.\n"
        )
        summary, raw = _parse_memory(path)
        assert "Patterns" in summary
        assert "Some content" in summary
        assert raw == ""

    def test_new_format_with_separator(self, tmp_path: Path):
        path = tmp_path / "memory.md"
        path.write_text(
            "# Memory\n\n*Last summarized: 2026-03-12*\n\n## Summary\n\nStuff.\n\n"
            "---\n\n## Recent Activity\n\n## 2026-03-14T10:00:00+00:00\n\n- entry\n"
        )
        summary, raw = _parse_memory(path)
        assert "Stuff" in summary
        assert "2026-03-14" in raw


class TestSplitEntries:
    def test_splits_on_timestamp_headers(self):
        text = (
            "## 2026-03-13T10:00:00+00:00\n\n- entry 1\n\n"
            "## 2026-03-14T09:00:00+00:00\n\n- entry 2\n"
        )
        entries = _split_entries(text)
        assert len(entries) == 2
        assert "entry 1" in entries[0]
        assert "entry 2" in entries[1]

    def test_empty_text(self):
        assert _split_entries("") == []
        assert _split_entries("   ") == []

    def test_single_entry(self):
        text = "## 2026-03-13T10:00:00+00:00\n\n- only entry\n"
        entries = _split_entries(text)
        assert len(entries) == 1


class TestWriteMemory:
    def test_writes_summary_and_entries(self, tmp_path: Path):
        path = tmp_path / "memory.md"
        entries = [
            "## 2026-03-14T10:00:00+00:00\n\n- entry 1",
            "## 2026-03-14T11:00:00+00:00\n\n- entry 2",
        ]
        _write_memory(path, "## Patterns\n\nSummary here.", entries)

        content = path.read_text()
        assert "# Memory" in content
        assert "Last summarized" in content
        assert "Patterns" in content
        assert "---" in content
        assert "## Recent Activity" in content
        assert "entry 1" in content
        assert "entry 2" in content

    def test_writes_entries_only_no_summary(self, tmp_path: Path):
        path = tmp_path / "memory.md"
        _write_memory(path, "", ["## 2026-03-14T10:00:00+00:00\n\n- entry"])

        content = path.read_text()
        assert "# Memory" in content
        assert "---" in content
        assert "entry" in content

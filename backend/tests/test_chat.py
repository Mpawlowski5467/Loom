"""Tests for agents/chat.py — chat persistence layer."""

from pathlib import Path

from agents.chat import ChatHistory, ChatMessage


def _setup_vault(tmp_path: Path) -> Path:
    """Create minimal vault with chat directories."""
    root = tmp_path / "vault"
    root.mkdir()
    # Shuttle agent chat dirs
    (root / "agents" / "researcher" / "chat").mkdir(parents=True)
    (root / "agents" / "standup" / "chat").mkdir(parents=True)
    # Council chat dir
    (root / "agents" / "_council" / "chat").mkdir(parents=True)
    return root


class TestSaveMessage:
    def test_saves_user_message(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        msg = chat.save_message("researcher", "user", "What is caching?")

        assert msg.role == "user"
        assert msg.content == "What is caching?"
        assert msg.agent == "researcher"
        assert msg.timestamp

    def test_saves_assistant_message(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        msg = chat.save_message("researcher", "assistant", "Caching stores data for fast access.")

        assert msg.role == "assistant"

    def test_creates_chat_file(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat.save_message("researcher", "user", "Hello")

        chat_dir = root / "agents" / "researcher" / "chat"
        files = list(chat_dir.glob("*.md"))
        assert len(files) == 1
        content = files[0].read_text(encoding="utf-8")
        assert "# Chat" in content
        assert "### user" in content
        assert "Hello" in content

    def test_appends_to_existing_file(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat.save_message("researcher", "user", "First message")
        chat.save_message("researcher", "assistant", "First reply")
        chat.save_message("researcher", "user", "Second message")

        chat_dir = root / "agents" / "researcher" / "chat"
        files = list(chat_dir.glob("*.md"))
        assert len(files) == 1  # Same day, same file
        content = files[0].read_text(encoding="utf-8")
        assert content.count("### user") == 2
        assert content.count("### assistant") == 1

    def test_council_uses_council_dir(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat.save_message("_council", "user", "Council message")

        council_dir = root / "agents" / "_council" / "chat"
        files = list(council_dir.glob("*.md"))
        assert len(files) == 1

    def test_message_format(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat.save_message("researcher", "user", "Test content", timestamp="2026-03-15T10:30:00+00:00")

        chat_dir = root / "agents" / "researcher" / "chat"
        content = list(chat_dir.glob("*.md"))[0].read_text(encoding="utf-8")
        assert "### user — 2026-03-15T10:30:00+00:00" in content
        assert "Test content" in content


class TestLoadRecent:
    def test_loads_messages_in_order(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat.save_message("researcher", "user", "Message 1", timestamp="2026-03-15T10:00:00+00:00")
        chat.save_message("researcher", "assistant", "Reply 1", timestamp="2026-03-15T10:00:05+00:00")
        chat.save_message("researcher", "user", "Message 2", timestamp="2026-03-15T10:01:00+00:00")

        messages = chat.load_recent("researcher", limit=20)

        assert len(messages) == 3
        assert messages[0].role == "user"
        assert messages[0].content == "Message 1"
        assert messages[1].role == "assistant"
        assert messages[2].content == "Message 2"

    def test_respects_limit(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        for i in range(10):
            chat.save_message("researcher", "user", f"Msg {i}", timestamp=f"2026-03-15T10:{i:02d}:00+00:00")

        messages = chat.load_recent("researcher", limit=3)
        assert len(messages) == 3
        # Should be the last 3 messages
        assert messages[0].content == "Msg 7"
        assert messages[2].content == "Msg 9"

    def test_empty_history(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        messages = chat.load_recent("researcher")
        assert messages == []

    def test_loads_across_days(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        # Manually write chat files for two different dates
        chat_dir = root / "agents" / "researcher" / "chat"
        (chat_dir / "2026-03-14.md").write_text(
            "# Chat — researcher — 2026-03-14\n\n"
            "### user — 2026-03-14T10:00:00+00:00\n\nYesterday's question\n\n"
            "### assistant — 2026-03-14T10:00:05+00:00\n\nYesterday's answer\n\n",
            encoding="utf-8",
        )
        (chat_dir / "2026-03-15.md").write_text(
            "# Chat — researcher — 2026-03-15\n\n"
            "### user — 2026-03-15T09:00:00+00:00\n\nToday's question\n\n",
            encoding="utf-8",
        )

        messages = chat.load_recent("researcher", limit=20)
        assert len(messages) == 3
        assert messages[0].content == "Yesterday's question"
        assert messages[2].content == "Today's question"


class TestLoadDay:
    def test_loads_specific_day(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat_dir = root / "agents" / "researcher" / "chat"
        (chat_dir / "2026-03-14.md").write_text(
            "# Chat — researcher — 2026-03-14\n\n"
            "### user — 2026-03-14T10:00:00+00:00\n\nSpecific day\n\n",
            encoding="utf-8",
        )

        messages = chat.load_day("researcher", "2026-03-14")
        assert len(messages) == 1
        assert messages[0].content == "Specific day"

    def test_missing_day_returns_empty(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        messages = chat.load_day("researcher", "2020-01-01")
        assert messages == []


class TestListSessions:
    def test_lists_session_dates(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat_dir = root / "agents" / "researcher" / "chat"
        (chat_dir / "2026-03-13.md").write_text("# Chat\n\n", encoding="utf-8")
        (chat_dir / "2026-03-14.md").write_text("# Chat\n\n", encoding="utf-8")
        (chat_dir / "2026-03-15.md").write_text("# Chat\n\n", encoding="utf-8")

        sessions = chat.list_sessions("researcher")
        assert sessions == ["2026-03-13", "2026-03-14", "2026-03-15"]

    def test_empty_sessions(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        sessions = chat.list_sessions("researcher")
        assert sessions == []


class TestToLlmMessage:
    def test_user_message(self):
        msg = ChatMessage(role="user", content="Hello", timestamp="2026-03-15T10:00:00+00:00")
        assert msg.to_llm_message() == {"role": "user", "content": "Hello"}

    def test_assistant_message(self):
        msg = ChatMessage(role="assistant", content="Hi", timestamp="2026-03-15T10:00:00+00:00")
        assert msg.to_llm_message() == {"role": "assistant", "content": "Hi"}

    def test_agent_message_maps_to_assistant(self):
        msg = ChatMessage(role="agent:weaver", content="Done", timestamp="2026-03-15T10:00:00+00:00")
        assert msg.to_llm_message() == {"role": "assistant", "content": "Done"}


class TestParseRoundTrip:
    def test_save_and_reload(self, tmp_path: Path):
        """Messages survive a save → parse round trip."""
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        chat.save_message("researcher", "user", "What are CRDTs?", timestamp="2026-03-15T10:00:00+00:00")
        chat.save_message(
            "researcher", "assistant",
            "CRDTs are Conflict-free Replicated Data Types.\n\nThey enable distributed consistency.",
            timestamp="2026-03-15T10:00:05+00:00",
        )

        loaded = chat.load_recent("researcher")
        assert len(loaded) == 2
        assert loaded[0].role == "user"
        assert loaded[0].content == "What are CRDTs?"
        assert loaded[0].timestamp == "2026-03-15T10:00:00+00:00"
        assert loaded[1].role == "assistant"
        assert "Conflict-free" in loaded[1].content
        assert "distributed consistency" in loaded[1].content

    def test_multiline_content_preserved(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        chat = ChatHistory(root)

        content = "Line 1\n\nLine 2\n\n- Bullet 1\n- Bullet 2"
        chat.save_message("researcher", "user", content, timestamp="2026-03-15T10:00:00+00:00")

        loaded = chat.load_recent("researcher")
        assert len(loaded) == 1
        assert "Line 1" in loaded[0].content
        assert "Bullet 2" in loaded[0].content

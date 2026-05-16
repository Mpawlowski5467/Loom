"""Tests for Shuttle-layer agents: Researcher and Standup."""

import json
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import yaml

from agents.changelog import log_action
from agents.shuttle.researcher import Researcher, ResearchResult
from agents.shuttle.standup import Standup, StandupResult
from core.notes import build_frontmatter, now_iso, parse_note


def _setup_vault(tmp_path: Path) -> Path:
    """Create a vault with notes for shuttle agent testing."""
    root = tmp_path / "vault"
    root.mkdir()

    (root / "vault.yaml").write_text(yaml.safe_dump({"name": "test"}), encoding="utf-8")

    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nBe good.\n", encoding="utf-8")

    # Create agent dirs for shuttle agents
    for agent_name in ["researcher", "standup"]:
        agent_dir = root / "agents" / agent_name
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text(
            yaml.safe_dump(
                {
                    "name": agent_name,
                    "enabled": True,
                    "trust_level": "standard",
                    "memory_threshold": 100,
                }
            ),
            encoding="utf-8",
        )
        (agent_dir / "memory.md").write_text("# Memory\n\nEmpty.\n", encoding="utf-8")
        (agent_dir / "state.json").write_text(
            json.dumps({"action_count": 0, "last_action": None}), encoding="utf-8"
        )
        (agent_dir / "logs").mkdir()
        (agent_dir / "chat").mkdir()
        (root / ".loom" / "changelog" / agent_name).mkdir(parents=True, exist_ok=True)

    for folder in ["daily", "projects", "topics", "people", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True, exist_ok=True)

    # Create test notes the researcher can find
    ts = now_iso()
    _write_note(
        root,
        "topics",
        "caching-strategies.md",
        {
            "id": "thr_cache0",
            "title": "Caching Strategies",
            "type": "topic",
            "tags": ["caching", "performance"],
            "created": ts,
            "modified": ts,
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## Summary\n\nOverview of caching techniques.\n\n## Details\n\nRedis, Memcached, CDN caching.\n",
    )

    _write_note(
        root,
        "topics",
        "database-indexing.md",
        {
            "id": "thr_dbidx0",
            "title": "Database Indexing",
            "type": "topic",
            "tags": ["database", "performance"],
            "created": ts,
            "modified": ts,
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## Summary\n\nHow to index databases.\n\n## Details\n\nB-tree, hash, GIN indexes.\n",
    )

    return root


def _write_note(root: Path, folder: str, filename: str, meta: dict, body: str) -> Path:
    path = root / "threads" / folder / filename
    path.write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return path


# =============================================================================
# Researcher tests
# =============================================================================


class TestResearcher:
    @pytest.mark.asyncio
    async def test_query_without_llm(self, tmp_path: Path):
        """Researcher answers using raw vault context when no chat provider."""
        root = _setup_vault(tmp_path)
        researcher = Researcher(root, chat_provider=None)

        result = await researcher.query("caching")

        assert isinstance(result, ResearchResult)
        assert result.answer  # Non-empty
        assert "Vault Context" in result.answer  # Falls back to raw context

    @pytest.mark.asyncio
    async def test_query_saves_capture(self, tmp_path: Path):
        """Research findings are saved to captures/."""
        root = _setup_vault(tmp_path)
        researcher = Researcher(root, chat_provider=None)

        result = await researcher.query("caching")

        assert result.capture_id.startswith("thr_")
        assert result.capture_path
        capture_path = Path(result.capture_path)
        assert capture_path.exists()

        note = parse_note(capture_path)
        assert note.type == "capture"
        assert note.author == "agent:researcher"
        assert "research" in note.tags
        assert "caching" in note.body.lower()

    @pytest.mark.asyncio
    async def test_query_with_llm(self, tmp_path: Path):
        """Researcher uses LLM for synthesis when available."""
        root = _setup_vault(tmp_path)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(
            return_value="Based on vault notes, caching strategies include Redis and Memcached."
        )

        researcher = Researcher(root, chat_provider=chat_mock)
        result = await researcher.query("What caching strategies do we use?")

        assert "Redis" in result.answer
        assert chat_mock.chat.called

    @pytest.mark.asyncio
    async def test_query_logs_to_changelog(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        researcher = Researcher(root, chat_provider=None)

        await researcher.query("testing")

        changelog_dir = root / ".loom" / "changelog" / "researcher"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Agent:** researcher" in content
        assert "**Action:** researched" in content

    @pytest.mark.asyncio
    async def test_query_updates_state(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        researcher = Researcher(root, chat_provider=None)

        await researcher.query("anything")

        assert researcher.state.action_count == 1

    @pytest.mark.asyncio
    async def test_keyword_fallback_finds_notes(self, tmp_path: Path):
        """When no vector searcher, keyword fallback still finds relevant notes."""
        root = _setup_vault(tmp_path)

        # Build the in-memory note index so keyword search works
        from core.note_index import get_note_index

        index = get_note_index()
        index.build(root / "threads")

        researcher = Researcher(root, chat_provider=None)
        result = await researcher.query("caching")

        # Should find the caching note via keyword match
        assert "Caching" in result.answer or "caching" in result.answer.lower()


# =============================================================================
# Standup tests
# =============================================================================


class TestStandup:
    @pytest.mark.asyncio
    async def test_generate_with_activity(self, tmp_path: Path):
        """Standup generates recap when changelog has entries."""
        root = _setup_vault(tmp_path)
        # Create changelog entries for today
        log_action(root, "weaver", "created", "topics/test.md", details="Created note")
        log_action(root, "spider", "linked", "thr_abc123", details="Linked notes")

        standup = Standup(root, chat_provider=None)
        result = await standup.generate()

        assert isinstance(result, StandupResult)
        assert result.recap  # Non-empty
        # Standup defaults to UTC date (matching changelog timestamps)
        from core.notes import now_iso

        assert result.date == now_iso()[:10]

    @pytest.mark.asyncio
    async def test_generate_saves_capture(self, tmp_path: Path):
        """Standup recap is saved to captures/."""
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "created", "test.md")

        standup = Standup(root, chat_provider=None)
        result = await standup.generate()

        assert result.capture_id.startswith("thr_")
        assert result.capture_path
        capture_path = Path(result.capture_path)
        assert capture_path.exists()

        note = parse_note(capture_path)
        assert note.type == "capture"
        assert note.author == "agent:standup"
        assert "standup" in note.tags

    @pytest.mark.asyncio
    async def test_generate_no_activity(self, tmp_path: Path):
        """Standup returns empty recap when no activity."""
        root = _setup_vault(tmp_path)
        standup = Standup(root, chat_provider=None)

        # Use a date with no activity
        result = await standup.generate(date(2020, 1, 1))

        assert result.recap == ""
        assert result.notes_modified == 0

    @pytest.mark.asyncio
    async def test_generate_with_llm(self, tmp_path: Path):
        """Standup uses LLM for better recap when available."""
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "created", "test.md")

        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(
            return_value="## Highlights\n\n- Created a new test note\n\n## Notes Touched\n\n- [[Test]]\n"
        )

        standup = Standup(root, chat_provider=chat_mock)
        result = await standup.generate()

        assert "Highlights" in result.recap
        assert chat_mock.chat.called

    @pytest.mark.asyncio
    async def test_generate_logs_to_changelog(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "created", "test.md")

        standup = Standup(root, chat_provider=None)
        await standup.generate()

        changelog_dir = root / ".loom" / "changelog" / "standup"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Agent:** standup" in content

    @pytest.mark.asyncio
    async def test_generate_specific_date(self, tmp_path: Path):
        """Can generate standup for a specific past date."""
        root = _setup_vault(tmp_path)
        # Write a changelog entry for a specific date manually
        changelog_dir = root / ".loom" / "changelog" / "weaver"
        changelog_dir.mkdir(parents=True, exist_ok=True)
        (changelog_dir / "2026-03-10.md").write_text(
            "# Changelog — 2026-03-10\n\n## 2026-03-10T10:00:00+00:00\n\n"
            "- **Agent:** weaver\n- **Action:** created\n- **Target:** test.md\n\n",
            encoding="utf-8",
        )

        standup = Standup(root, chat_provider=None)
        result = await standup.generate(date(2026, 3, 10))

        assert result.date == "2026-03-10"
        assert result.recap  # Non-empty because there's changelog data


# =============================================================================
# Shuttle boundary test
# =============================================================================


class TestShuttleBoundary:
    @pytest.mark.asyncio
    async def test_researcher_writes_only_to_captures(self, tmp_path: Path):
        """Researcher must write only to captures/ (shuttle boundary)."""
        root = _setup_vault(tmp_path)
        researcher = Researcher(root, chat_provider=None)
        result = await researcher.query("test question")

        assert "captures" in result.capture_path

    @pytest.mark.asyncio
    async def test_standup_writes_only_to_captures(self, tmp_path: Path):
        """Standup must write only to captures/ (shuttle boundary)."""
        root = _setup_vault(tmp_path)
        log_action(root, "weaver", "created", "test.md")

        standup = Standup(root, chat_provider=None)
        result = await standup.generate()

        assert "captures" in result.capture_path

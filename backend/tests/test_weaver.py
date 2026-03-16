"""Tests for agents/loom/weaver.py — the Weaver creator agent."""

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import yaml

from agents.loom.weaver import Weaver, _parse_classification
from core.exceptions import ReadChainError
from core.notes import build_frontmatter


def _setup_vault(tmp_path: Path, trust_level: str = "standard") -> Path:
    """Create a vault with the structure needed for Weaver tests."""
    root = tmp_path / "vault"
    root.mkdir()

    # vault.yaml
    (root / "vault.yaml").write_text(yaml.safe_dump({"name": "test"}), encoding="utf-8")

    # rules/
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nBe good.\n", encoding="utf-8")

    # rules/schemas/
    schemas = rules / "schemas"
    schemas.mkdir()
    (schemas / "topic.md").write_text(
        "# Schema: Topic\n\n## Expected Sections\n\n"
        "- `## Summary`\n- `## Details`\n- `## References`\n",
        encoding="utf-8",
    )
    (schemas / "project.md").write_text(
        "# Schema: Project\n\n## Expected Sections\n\n"
        "- `## Overview`\n- `## Goals`\n- `## Status`\n- `## Related`\n",
        encoding="utf-8",
    )

    # agents/weaver/
    agent_dir = root / "agents" / "weaver"
    agent_dir.mkdir(parents=True)
    (agent_dir / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "name": "weaver",
                "enabled": True,
                "trust_level": trust_level,
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

    # .loom/changelog/weaver/
    (root / ".loom" / "changelog" / "weaver").mkdir(parents=True)

    # threads/
    for folder in ["daily", "projects", "topics", "people", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True)

    return root


def _write_capture(root: Path, filename: str, title: str, body: str) -> Path:
    """Write a capture note to the vault."""
    meta = {
        "id": f"thr_{filename[:6]}",
        "title": title,
        "type": "capture",
        "tags": ["inbox"],
        "created": "2026-03-15T00:00:00+00:00",
        "modified": "2026-03-15T00:00:00+00:00",
        "author": "user",
        "source": "manual",
        "status": "active",
    }
    path = root / "threads" / "captures" / filename
    path.write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return path


class TestParseClassification:
    def test_parses_standard_response(self):
        text = "type: topic\nfolder: topics\ntitle: My Great Note\ntags: ai, ml, deep-learning"
        result = _parse_classification(text)
        assert result["type"] == "topic"
        assert result["folder"] == "topics"
        assert result["title"] == "My Great Note"
        assert result["tags"] == "ai, ml, deep-learning"

    def test_ignores_extra_lines(self):
        text = "Here's the classification:\ntype: project\nfolder: projects\ntitle: Foo\ntags: x"
        result = _parse_classification(text)
        assert result["type"] == "project"

    def test_empty_input(self):
        assert _parse_classification("") == {}


class TestWeaverProcessCapture:
    @pytest.mark.asyncio
    async def test_process_capture_without_llm(self, tmp_path: Path):
        """Weaver processes a capture using heuristic fallback (no chat provider)."""
        root = _setup_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-001.md",
            "Research Notes",
            "This is a topic about distributed systems and CRDTs.\n\n"
            "Key concepts: eventual consistency, conflict resolution.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert note.id.startswith("thr_")
        assert note.type == "topic"
        assert note.author == "agent:weaver"
        assert note.status == "active"
        assert "source" in note.model_dump()
        # Note should be in topics/ folder
        assert "/topics/" in note.file_path

    @pytest.mark.asyncio
    async def test_process_capture_with_llm(self, tmp_path: Path):
        """Weaver uses the LLM to classify and generate content."""
        root = _setup_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-002.md",
            "Meeting Notes",
            "Meeting with the team about the Meridian project.\n"
            "Discussed milestones and sprint planning.\n",
        )

        chat_mock = AsyncMock()
        # First call: classification
        chat_mock.chat = AsyncMock(
            side_effect=[
                "type: project\nfolder: projects\ntitle: Meridian Project\ntags: project, planning",
                "## Overview\n\nMeridian project planning meeting.\n\n## Goals\n\n- Define milestones\n",
            ]
        )

        weaver = Weaver(root, chat_provider=chat_mock)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert note.type == "project"
        assert note.title == "Meridian Project"
        assert "project" in note.tags
        assert "/projects/" in note.file_path
        assert chat_mock.chat.call_count == 2

    @pytest.mark.asyncio
    async def test_process_empty_capture_skipped(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        capture_path = _write_capture(root, "cap-empty.md", "Empty", "")

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is None

    @pytest.mark.asyncio
    async def test_process_capture_logs_to_changelog(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-log.md",
            "Logging Test",
            "Some content about algorithms.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        await weaver.process_capture(capture_path)

        # Check changelog was written
        changelog_dir = root / ".loom" / "changelog" / "weaver"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Agent:** weaver" in content
        assert "**Action:** created" in content
        assert "**Chain:** pass" in content

    @pytest.mark.asyncio
    async def test_process_capture_updates_state(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-state.md",
            "State Test",
            "Content for state tracking.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        await weaver.process_capture(capture_path)

        assert weaver.state.action_count == 1
        assert weaver.state.last_action is not None


class TestWeaverCreateFromModal:
    @pytest.mark.asyncio
    async def test_create_skeleton_note(self, tmp_path: Path):
        """Create a note with no content — should get skeleton sections."""
        root = _setup_vault(tmp_path)
        weaver = Weaver(root, chat_provider=None)

        note = await weaver.create_from_modal(
            title="Test Topic",
            note_type="topic",
            tags=["test"],
            folder="topics",
            content="",
        )

        assert note.id.startswith("thr_")
        assert note.title == "Test Topic"
        assert note.type == "topic"
        assert "test" in note.tags
        assert note.author == "agent:weaver"
        # Should have skeleton sections
        assert "## Summary" in note.body

    @pytest.mark.asyncio
    async def test_create_with_content(self, tmp_path: Path):
        """Create a note with user-provided content (no LLM)."""
        root = _setup_vault(tmp_path)
        weaver = Weaver(root, chat_provider=None)

        note = await weaver.create_from_modal(
            title="My Project",
            note_type="project",
            tags=["alpha"],
            folder="projects",
            content="This is a project about building things.",
        )

        assert note.title == "My Project"
        assert note.type == "project"
        assert "building things" in note.body
        assert "/projects/" in note.file_path

    @pytest.mark.asyncio
    async def test_create_with_llm_formatting(self, tmp_path: Path):
        """When chat provider is available, content is formatted per schema."""
        root = _setup_vault(tmp_path)
        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(
            return_value="## Summary\n\nFormatted by LLM.\n\n## Details\n\nMore info.\n"
        )

        weaver = Weaver(root, chat_provider=chat_mock)
        note = await weaver.create_from_modal(
            title="Formatted Note",
            note_type="topic",
            tags=[],
            folder="topics",
            content="Raw user input.",
        )

        assert "Formatted by LLM" in note.body
        assert chat_mock.chat.called

    @pytest.mark.asyncio
    async def test_frontmatter_complete(self, tmp_path: Path):
        """All required frontmatter fields are present."""
        root = _setup_vault(tmp_path)
        weaver = Weaver(root, chat_provider=None)

        note = await weaver.create_from_modal(
            title="Complete Note",
            note_type="topic",
            tags=["a", "b"],
            folder="topics",
            content="",
        )

        assert note.id.startswith("thr_")
        assert note.title == "Complete Note"
        assert note.type == "topic"
        assert note.tags == ["a", "b"]
        assert note.created  # non-empty
        assert note.modified  # non-empty
        assert note.author == "agent:weaver"
        assert note.status == "active"
        assert len(note.history) >= 1
        assert note.history[0].action == "created"
        assert note.history[0].by == "agent:weaver"

    @pytest.mark.asyncio
    async def test_filename_is_kebab_case(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        weaver = Weaver(root, chat_provider=None)

        note = await weaver.create_from_modal(
            title="My Great Title With Spaces",
            note_type="topic",
            tags=[],
            folder="topics",
            content="",
        )

        assert "my-great-title-with-spaces" in note.file_path


class TestWeaverChainEnforcement:
    @pytest.mark.asyncio
    async def test_blocked_when_prime_missing(self, tmp_path: Path):
        """Standard trust Weaver is blocked if prime.md is missing."""
        root = _setup_vault(tmp_path, trust_level="standard")
        (root / "rules" / "prime.md").unlink()

        weaver = Weaver(root, chat_provider=None)

        with pytest.raises(ReadChainError):
            await weaver.create_from_modal(
                title="Blocked",
                note_type="topic",
                tags=[],
                folder="topics",
                content="",
            )

    @pytest.mark.asyncio
    async def test_trusted_proceeds_when_prime_missing(self, tmp_path: Path):
        """Trusted Weaver proceeds with warning if prime.md is missing."""
        root = _setup_vault(tmp_path, trust_level="trusted")
        (root / "rules" / "prime.md").unlink()

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.create_from_modal(
            title="Trusted Note",
            note_type="topic",
            tags=[],
            folder="topics",
            content="",
        )

        assert note is not None
        assert note.title == "Trusted Note"

        # Check changelog has chain_status="warn"
        changelog_dir = root / ".loom" / "changelog" / "weaver"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1
        content = files[0].read_text(encoding="utf-8")
        assert "**Chain:** warn" in content


class TestWeaverHeuristic:
    @pytest.mark.asyncio
    async def test_daily_keyword_classification(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-daily.md",
            "Morning Log",
            "This morning I had standup and discussed progress.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert note.type == "daily"
        assert "/daily/" in note.file_path

    @pytest.mark.asyncio
    async def test_project_keyword_classification(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-proj.md",
            "Sprint Ideas",
            "This project milestone involves a new sprint roadmap.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert note.type == "project"
        assert "/projects/" in note.file_path

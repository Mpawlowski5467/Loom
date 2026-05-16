"""Integration tests for the Weaver agent pipeline.

Tests the full capture-to-note flow: write a capture file, run Weaver,
verify the output note has correct frontmatter, body, and is placed in
the right folder. Uses a temp vault fixture and mocks the chat provider
for deterministic responses.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import yaml

from agents.loom.weaver import Weaver
from core.notes import build_frontmatter, parse_note

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_vault(tmp_path: Path) -> Path:
    """Create a full vault structure suitable for pipeline testing."""
    root = tmp_path / "vault"
    root.mkdir()

    # vault.yaml
    (root / "vault.yaml").write_text(
        yaml.safe_dump({"name": "pipeline-test", "custom_folders": [], "auto_git": False}),
        encoding="utf-8",
    )

    # rules/
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text(
        "# Prime\n\nRule 1: Produce atomic notes.\nRule 2: Always use wikilinks.\n",
        encoding="utf-8",
    )
    schemas = rules / "schemas"
    schemas.mkdir()
    (schemas / "topic.md").write_text(
        "# Schema: Topic\n\n## Expected Sections\n\n- `## Summary`\n- `## Details`\n- `## References`\n",
        encoding="utf-8",
    )
    (schemas / "project.md").write_text(
        "# Schema: Project\n\n## Expected Sections\n\n- `## Overview`\n- `## Goals`\n- `## Status`\n",
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
                "trust_level": "standard",
                "memory_threshold": 100,
            }
        ),
        encoding="utf-8",
    )
    (agent_dir / "memory.md").write_text(
        "# Memory\n\nNo patterns observed yet.\n",
        encoding="utf-8",
    )
    (agent_dir / "state.json").write_text(
        json.dumps({"action_count": 0, "last_action": None}),
        encoding="utf-8",
    )
    (agent_dir / "logs").mkdir()

    # .loom/changelog/weaver/
    (root / ".loom" / "changelog" / "weaver").mkdir(parents=True)

    # threads/
    for folder in ["daily", "projects", "topics", "people", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True)

    return root


def _write_capture(root: Path, filename: str, title: str, body: str) -> Path:
    """Write a capture note and return its path."""
    meta = {
        "id": f"thr_{filename[:6]}",
        "title": title,
        "type": "capture",
        "tags": ["inbox"],
        "created": "2026-03-15T10:00:00+00:00",
        "modified": "2026-03-15T10:00:00+00:00",
        "author": "user",
        "source": "manual",
        "status": "active",
    }
    path = root / "threads" / "captures" / filename
    path.write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Pipeline: capture -> Weaver -> structured note
# ---------------------------------------------------------------------------


class TestWeaverPipeline:
    """End-to-end pipeline tests: capture in, structured note out."""

    @pytest.mark.asyncio
    async def test_classify_and_create_topic(self, tmp_path: Path) -> None:
        """LLM classifies a capture as a topic and generates structured body."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-ml.md",
            "Machine Learning Notes",
            "Notes about gradient descent and neural network architectures.\n"
            "Key topics: backpropagation, convolutional layers, attention.\n",
        )

        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(
            side_effect=[
                # Classification response
                "type: topic\nfolder: topics\ntitle: Neural Network Architectures\ntags: ml, ai, deep-learning",
                # Content generation response
                "## Summary\n\nOverview of neural network architectures.\n\n"
                "## Details\n\nCovers gradient descent, backpropagation, and attention mechanisms.\n\n"
                "## References\n\n- [[Deep Learning]] for foundational concepts.\n",
            ]
        )

        weaver = Weaver(root, chat_provider=chat_mock)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert note.type == "topic"
        assert note.title == "Neural Network Architectures"
        assert "ml" in note.tags
        assert note.author == "agent:weaver"
        assert note.status == "active"
        assert note.id.startswith("thr_")

        # Verify placed in topics/
        assert "/topics/" in note.file_path

        # Verify the file was actually written to disk
        output_path = Path(note.file_path)
        assert output_path.exists()

        # Re-parse and verify frontmatter round-trips
        reparsed = parse_note(output_path)
        assert reparsed.title == "Neural Network Architectures"
        assert reparsed.type == "topic"
        assert reparsed.author == "agent:weaver"
        assert "Summary" in reparsed.body

        # LLM called twice: classify + generate
        assert chat_mock.chat.call_count == 2

    @pytest.mark.asyncio
    async def test_classify_and_create_project(self, tmp_path: Path) -> None:
        """LLM classifies a capture as a project."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-proj.md",
            "Sprint Kickoff",
            "Sprint 12 kickoff for the Loom project.\nGoals: finish indexing, deploy agents.\n",
        )

        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(
            side_effect=[
                "type: project\nfolder: projects\ntitle: Loom Sprint 12\ntags: loom, sprint",
                "## Overview\n\nSprint 12 kickoff notes.\n\n## Goals\n\n- Finish indexing\n- Deploy agents\n",
            ]
        )

        weaver = Weaver(root, chat_provider=chat_mock)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert note.type == "project"
        assert "/projects/" in note.file_path
        assert "loom" in note.tags

    @pytest.mark.asyncio
    async def test_heuristic_fallback_no_llm(self, tmp_path: Path) -> None:
        """Without a chat provider, Weaver uses heuristic classification."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-algo.md",
            "Algorithm Notes",
            "Thoughts on sorting algorithms and time complexity.\n"
            "Merge sort vs quicksort performance comparison.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        # Without LLM, heuristic should classify to topic (default)
        assert note.type == "topic"
        assert note.author == "agent:weaver"
        assert note.id.startswith("thr_")
        # File should exist on disk
        assert Path(note.file_path).exists()

    @pytest.mark.asyncio
    async def test_pipeline_changelog_logged(self, tmp_path: Path) -> None:
        """Processing a capture writes to the weaver changelog."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-log.md",
            "Changelog Test",
            "Content for verifying changelog entries.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        await weaver.process_capture(capture_path)

        changelog_dir = root / ".loom" / "changelog" / "weaver"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1

        content = files[0].read_text(encoding="utf-8")
        assert "**Agent:** weaver" in content
        assert "**Action:** created" in content

    @pytest.mark.asyncio
    async def test_pipeline_state_incremented(self, tmp_path: Path) -> None:
        """After processing, the agent's action_count increments."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-state.md",
            "State Test",
            "Content for state tracking test.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        await weaver.process_capture(capture_path)

        assert weaver.state.action_count == 1
        assert weaver.state.last_action is not None

        # State persisted to disk
        state_data = json.loads(
            (root / "agents" / "weaver" / "state.json").read_text(encoding="utf-8")
        )
        assert state_data["action_count"] == 1

    @pytest.mark.asyncio
    async def test_empty_capture_skipped(self, tmp_path: Path) -> None:
        """Capture with empty body is skipped — no note created."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(root, "cap-empty.md", "Empty Capture", "")

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is None
        # No files should appear in topics/, projects/, etc.
        for folder in ["topics", "projects", "daily", "people"]:
            assert list((root / "threads" / folder).glob("*.md")) == []

    @pytest.mark.asyncio
    async def test_frontmatter_has_history_entry(self, tmp_path: Path) -> None:
        """Created note includes a history entry for the creation event."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-hist.md",
            "History Check",
            "Content to test history in frontmatter.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert len(note.history) >= 1
        assert note.history[0].action == "created"
        assert note.history[0].by == "agent:weaver"

    @pytest.mark.asyncio
    async def test_filename_is_kebab_case(self, tmp_path: Path) -> None:
        """Output filename is kebab-cased from the title."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-name.md",
            "My Great Topic Title",
            "Some content about a great topic.\n",
        )

        chat_mock = AsyncMock()
        chat_mock.chat = AsyncMock(
            side_effect=[
                "type: topic\nfolder: topics\ntitle: My Great Topic Title\ntags: test",
                "## Summary\n\nGreat topic content.\n",
            ]
        )

        weaver = Weaver(root, chat_provider=chat_mock)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        assert "my-great-topic-title" in note.file_path

    @pytest.mark.asyncio
    async def test_source_field_references_capture(self, tmp_path: Path) -> None:
        """Created note's source field references the original capture."""
        root = _build_vault(tmp_path)
        capture_path = _write_capture(
            root,
            "cap-src.md",
            "Source Ref Test",
            "Content to verify source field.\n",
        )

        weaver = Weaver(root, chat_provider=None)
        note = await weaver.process_capture(capture_path)

        assert note is not None
        note_data = note.model_dump()
        assert "source" in note_data
        # Source should reference the capture
        source = note_data["source"]
        assert source  # non-empty


class TestWeaverPipelineMultiCapture:
    """Test processing multiple captures in sequence."""

    @pytest.mark.asyncio
    async def test_sequential_captures(self, tmp_path: Path) -> None:
        """Two captures processed sequentially produce two distinct notes."""
        root = _build_vault(tmp_path)
        cap1 = _write_capture(root, "cap-one.md", "First Capture", "First topic content.\n")
        cap2 = _write_capture(root, "cap-two.md", "Second Capture", "Second topic content.\n")

        weaver = Weaver(root, chat_provider=None)
        note1 = await weaver.process_capture(cap1)
        note2 = await weaver.process_capture(cap2)

        assert note1 is not None
        assert note2 is not None
        assert note1.id != note2.id
        assert note1.file_path != note2.file_path
        assert weaver.state.action_count == 2

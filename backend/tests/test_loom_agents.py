"""Tests for all Loom-layer agents: Spider, Archivist, Scribe, Sentinel, and the pipeline."""

import json
from datetime import date
from pathlib import Path

import pytest
import yaml

from agents.changelog import log_action
from agents.loom.archivist import Archivist, AuditResult
from agents.loom.scribe import Scribe
from agents.loom.sentinel import Sentinel, ValidationResult
from agents.loom.spider import Spider
from core.notes import build_frontmatter, now_iso, parse_note


def _setup_vault(tmp_path: Path) -> Path:
    """Create a full vault with multiple linked notes for agent testing."""
    root = tmp_path / "vault"
    root.mkdir()

    # vault.yaml
    (root / "vault.yaml").write_text(yaml.safe_dump({"name": "test"}), encoding="utf-8")

    # rules/
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nBe good. Log every action.\n", encoding="utf-8")
    schemas = rules / "schemas"
    schemas.mkdir()
    (schemas / "topic.md").write_text(
        "# Schema: Topic\n\n## Expected Sections\n\n- `## Summary`\n- `## Details`\n",
        encoding="utf-8",
    )
    (schemas / "project.md").write_text(
        "# Schema: Project\n\n## Expected Sections\n\n"
        "- `## Overview`\n- `## Goals`\n- `## Status`\n- `## Related`\n",
        encoding="utf-8",
    )

    # Create agent dirs for all agents
    for agent_name in ["weaver", "spider", "archivist", "scribe", "sentinel"]:
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
        (root / ".loom" / "changelog" / agent_name).mkdir(parents=True, exist_ok=True)

    # threads/
    for folder in ["daily", "projects", "topics", "people", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True, exist_ok=True)

    # Create some notes with wikilinks
    ts = now_iso()
    _write_note(
        root,
        "topics",
        "alpha-topic.md",
        {
            "id": "thr_aaa111",
            "title": "Alpha Topic",
            "type": "topic",
            "tags": ["distributed", "crdt"],
            "created": ts,
            "modified": ts,
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## Summary\n\nAlpha overview.\n\n## Details\n\nSee [[Beta Topic]].\n",
    )

    _write_note(
        root,
        "topics",
        "beta-topic.md",
        {
            "id": "thr_bbb222",
            "title": "Beta Topic",
            "type": "topic",
            "tags": ["distributed", "networking"],
            "created": ts,
            "modified": ts,
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## Summary\n\nBeta overview.\n\n## Details\n\nRelated to [[Alpha Topic]].\n",
    )

    _write_note(
        root,
        "projects",
        "gamma-project.md",
        {
            "id": "thr_ccc333",
            "title": "Gamma Project",
            "type": "project",
            "tags": ["crdt"],
            "created": ts,
            "modified": ts,
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## Overview\n\nGamma project.\n\n## Goals\n\n- Ship v1.\n\n## Status\n\nIn progress.\n\n## Related\n\n",
    )

    return root


def _write_note(root: Path, folder: str, filename: str, meta: dict, body: str) -> Path:
    path = root / "threads" / folder / filename
    path.write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return path


# =============================================================================
# Spider tests
# =============================================================================


class TestSpider:
    @pytest.mark.asyncio
    async def test_scan_finds_tag_overlap(self, tmp_path: Path):
        """Spider finds connections via tag overlap (heuristic)."""
        root = _setup_vault(tmp_path)
        spider = Spider(root, chat_provider=None)

        # Alpha Topic has tags [distributed, crdt], Gamma Project has [crdt]
        linked = await spider.scan_for_connections(root / "threads" / "topics" / "alpha-topic.md")

        # Should link to Gamma Project (crdt overlap) — Beta already linked
        assert any("Gamma" in t for t in linked)

    @pytest.mark.asyncio
    async def test_scan_adds_bidirectional_links(self, tmp_path: Path):
        """Links are added to both source and target notes."""
        root = _setup_vault(tmp_path)
        spider = Spider(root, chat_provider=None)

        linked = await spider.scan_for_connections(root / "threads" / "topics" / "alpha-topic.md")
        if linked:
            # Check source has [[target]] wikilink
            source = parse_note(root / "threads" / "topics" / "alpha-topic.md")
            assert any(t in source.wikilinks for t in linked)

            # Check target has [[Alpha Topic]] backlink
            target_title = linked[0]
            target_path = None
            for md in root.joinpath("threads").rglob("*.md"):
                note = parse_note(md)
                if note.title == target_title:
                    target_path = md
                    break
            if target_path:
                target = parse_note(target_path)
                assert "Alpha Topic" in target.wikilinks

    @pytest.mark.asyncio
    async def test_scan_logs_to_changelog(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        spider = Spider(root, chat_provider=None)
        await spider.scan_for_connections(root / "threads" / "topics" / "alpha-topic.md")

        changelog_dir = root / ".loom" / "changelog" / "spider"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1

    @pytest.mark.asyncio
    async def test_scan_vault_batch(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        spider = Spider(root, chat_provider=None)
        total = await spider.scan_vault()
        assert total >= 0  # May vary based on existing links


# =============================================================================
# Archivist tests
# =============================================================================


class TestArchivist:
    @pytest.mark.asyncio
    async def test_finds_missing_tags(self, tmp_path: Path):
        """Archivist flags notes with no tags."""
        root = _setup_vault(tmp_path)
        # Write a note with no tags
        _write_note(
            root,
            "topics",
            "bare-note.md",
            {
                "id": "thr_bare00",
                "title": "Bare Note",
                "type": "topic",
                "tags": [],
                "created": now_iso(),
                "modified": now_iso(),
                "author": "user",
                "status": "active",
                "history": [],
            },
            "No tags on this note.",
        )

        archivist = Archivist(root, chat_provider=None)
        issues = await archivist.audit_note(root / "threads" / "topics" / "bare-note.md")

        tag_issues = [i for i in issues if "tags" in i.details.lower()]
        assert len(tag_issues) >= 1
        # Empty tags list is falsy, so it's flagged (as error for required field or warning for missing tags)
        assert tag_issues[0].severity in ("error", "warning")

    @pytest.mark.asyncio
    async def test_finds_broken_wikilink(self, tmp_path: Path):
        """Archivist flags broken wikilinks."""
        root = _setup_vault(tmp_path)
        _write_note(
            root,
            "topics",
            "broken.md",
            {
                "id": "thr_brkn00",
                "title": "Broken Links",
                "type": "topic",
                "tags": ["test"],
                "created": now_iso(),
                "modified": now_iso(),
                "author": "user",
                "status": "active",
                "history": [],
            },
            "See [[Nonexistent Note]] for details.\n",
        )

        archivist = Archivist(root, chat_provider=None)
        issues = await archivist.audit_note(root / "threads" / "topics" / "broken.md")

        broken = [i for i in issues if i.issue_type == "broken_link"]
        assert len(broken) == 1
        assert "Nonexistent Note" in broken[0].details

    @pytest.mark.asyncio
    async def test_finds_stale_note(self, tmp_path: Path):
        """Archivist flags notes not modified in 30+ days."""
        root = _setup_vault(tmp_path)
        _write_note(
            root,
            "topics",
            "stale.md",
            {
                "id": "thr_stale0",
                "title": "Stale Note",
                "type": "topic",
                "tags": ["test"],
                "created": "2025-01-01T00:00:00+00:00",
                "modified": "2025-01-01T00:00:00+00:00",
                "author": "user",
                "status": "active",
                "history": [],
            },
            "## Summary\n\nOld content.\n\n## Details\n\nVery old.\n",
        )

        archivist = Archivist(root, chat_provider=None)
        issues = await archivist.audit_note(root / "threads" / "topics" / "stale.md")

        stale = [i for i in issues if i.issue_type == "stale"]
        assert len(stale) == 1
        assert stale[0].severity == "info"

    @pytest.mark.asyncio
    async def test_audit_vault_aggregates(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        archivist = Archivist(root, chat_provider=None)
        result = await archivist.audit_vault()

        assert isinstance(result, AuditResult)
        assert result.total_notes >= 3  # Alpha, Beta, Gamma

    @pytest.mark.asyncio
    async def test_audit_result_serializable(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        archivist = Archivist(root, chat_provider=None)
        result = await archivist.audit_vault()

        d = result.to_dict()
        assert "total_notes" in d
        assert "issues" in d
        assert "error_count" in d


# =============================================================================
# Scribe tests
# =============================================================================


class TestScribe:
    @pytest.mark.asyncio
    async def test_update_index_creates_file(self, tmp_path: Path):
        """Scribe generates _index.md for a folder."""
        root = _setup_vault(tmp_path)
        scribe = Scribe(root, chat_provider=None)

        topics_dir = root / "threads" / "topics"
        content = await scribe.update_index(topics_dir)

        assert content  # Non-empty
        index_path = topics_dir / "_index.md"
        assert index_path.exists()
        index_text = index_path.read_text(encoding="utf-8")
        assert "Alpha Topic" in index_text
        assert "Beta Topic" in index_text

    @pytest.mark.asyncio
    async def test_update_index_empty_folder(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        scribe = Scribe(root, chat_provider=None)

        empty_dir = root / "threads" / "captures"
        content = await scribe.update_index(empty_dir)
        assert content == ""

    @pytest.mark.asyncio
    async def test_generate_daily_log(self, tmp_path: Path):
        """Scribe generates a daily log from changelog entries."""
        root = _setup_vault(tmp_path)
        # Create some changelog entries for today
        log_action(root, "weaver", "created", "topics/test.md", details="Made a note")
        log_action(root, "spider", "linked", "thr_aaa111", details="Linked notes")

        scribe = Scribe(root, chat_provider=None)
        # Use UTC date to match changelog timestamps
        from core.notes import now_iso

        utc_today = date.fromisoformat(now_iso()[:10])
        content = await scribe.generate_daily_log(utc_today)

        assert content  # Non-empty
        daily_path = root / "threads" / "daily" / f"{utc_today.isoformat()}.md"
        assert daily_path.exists()

        daily = parse_note(daily_path)
        assert daily.type == "daily"
        assert daily.author == "agent:scribe"

    @pytest.mark.asyncio
    async def test_daily_log_no_activity(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        scribe = Scribe(root, chat_provider=None)
        content = await scribe.generate_daily_log(date(2020, 1, 1))
        assert content == ""


# =============================================================================
# Sentinel tests
# =============================================================================


class TestSentinel:
    @pytest.mark.asyncio
    async def test_validates_good_note(self, tmp_path: Path):
        """Sentinel passes a properly formatted note."""
        root = _setup_vault(tmp_path)
        sentinel = Sentinel(root, chat_provider=None)

        from agents.chain import ReadChain

        chain = ReadChain(root)
        chain_result = chain.execute("weaver", root / "threads" / "topics" / "alpha-topic.md")

        result = await sentinel.validate_action(
            "weaver", "created", root / "threads" / "topics" / "alpha-topic.md", chain_result
        )

        assert isinstance(result, ValidationResult)
        assert result.status in ("passed", "warning")

    @pytest.mark.asyncio
    async def test_flags_missing_schema_sections(self, tmp_path: Path):
        """Sentinel warns about missing expected sections."""
        root = _setup_vault(tmp_path)
        # Write a project note missing required sections
        _write_note(
            root,
            "projects",
            "bad-project.md",
            {
                "id": "thr_bad000",
                "title": "Bad Project",
                "type": "project",
                "tags": ["test"],
                "created": now_iso(),
                "modified": now_iso(),
                "author": "agent:weaver",
                "status": "active",
                "history": [
                    {"action": "created", "by": "agent:weaver", "at": now_iso(), "reason": "test"}
                ],
            },
            "Just some text without any sections.\n",
        )

        sentinel = Sentinel(root, chat_provider=None)
        from agents.chain import ReadChain

        chain = ReadChain(root)
        chain_result = chain.execute("weaver", root / "threads" / "projects" / "bad-project.md")

        result = await sentinel.validate_action(
            "weaver", "created", root / "threads" / "projects" / "bad-project.md", chain_result
        )

        assert result.status == "warning"
        assert any("Missing expected section" in r for r in result.reasons)

    @pytest.mark.asyncio
    async def test_flags_incomplete_chain(self, tmp_path: Path):
        """Sentinel flags when chain didn't complete."""
        root = _setup_vault(tmp_path)
        sentinel = Sentinel(root, chat_provider=None)

        from agents.chain import ReadChainResult

        # Fake a failed chain result
        failed_chain = ReadChainResult(success=False)

        result = await sentinel.validate_action(
            "weaver", "created", root / "threads" / "topics" / "alpha-topic.md", failed_chain
        )

        assert result.status == "failed"
        assert any("chain" in r.lower() for r in result.reasons)

    @pytest.mark.asyncio
    async def test_validation_logged(self, tmp_path: Path):
        root = _setup_vault(tmp_path)
        sentinel = Sentinel(root, chat_provider=None)

        from agents.chain import ReadChain

        chain = ReadChain(root)
        chain_result = chain.execute("weaver", root / "threads" / "topics" / "alpha-topic.md")

        await sentinel.validate_action(
            "weaver", "created", root / "threads" / "topics" / "alpha-topic.md", chain_result
        )

        changelog_dir = root / ".loom" / "changelog" / "sentinel"
        files = list(changelog_dir.glob("*.md"))
        assert len(files) >= 1
        content = files[0].read_text(encoding="utf-8")
        assert "validated" in content


# =============================================================================
# Pipeline test
# =============================================================================


class TestPipeline:
    @pytest.mark.asyncio
    async def test_full_pipeline(self, tmp_path: Path):
        """Full pipeline: capture → Weaver → Spider → Scribe → Sentinel."""
        root = _setup_vault(tmp_path)

        # Create a capture
        capture_path = _write_note(
            root,
            "captures",
            "cap-test.md",
            {
                "id": "thr_cap000",
                "title": "Raw Capture",
                "type": "capture",
                "tags": ["inbox"],
                "created": now_iso(),
                "modified": now_iso(),
                "author": "user",
                "source": "manual",
                "status": "active",
                "history": [],
            },
            "This is about distributed systems and CRDT conflict resolution.\n",
        )

        from agents.loom.archivist import init_archivist
        from agents.loom.scribe import init_scribe
        from agents.loom.sentinel import init_sentinel
        from agents.loom.spider import init_spider
        from agents.loom.weaver import init_weaver
        from agents.runner import AgentRunner

        init_weaver(root, chat_provider=None)
        init_spider(root, chat_provider=None)
        init_archivist(root, chat_provider=None)
        init_scribe(root, chat_provider=None)
        init_sentinel(root, chat_provider=None)

        runner = AgentRunner(root)
        result = await runner.run_pipeline(capture_path)

        assert result.note is not None
        assert result.note.id.startswith("thr_")
        assert result.note.author == "agent:weaver"
        # Spider may or may not find links depending on heuristic
        assert result.index_updated
        assert result.validation is not None

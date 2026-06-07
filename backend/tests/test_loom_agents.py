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

    @pytest.mark.asyncio
    async def test_does_not_duplicate_link_across_kebab_and_title_case(self, tmp_path: Path):
        """Regression: Spider used to append [[Title Case]] even when the body
        already contained [[kebab-case]] for the same note. The duplicate
        check compared raw wikilink strings; after lowercasing, ``inventory
        sync refactor`` ≠ ``inventory-sync-refactor``, so the check always
        failed and Spider re-appended the same link on every scan.

        The fix resolves wikilinks to *file paths* before comparing.
        """
        from agents.loom.spider_linker import apply_links

        root = _setup_vault(tmp_path)

        # Write a source note that already references the target via the
        # kebab-case form embedded in the body. Also pre-add the backlink
        # on the target so we exercise the "both sides already linked"
        # case — that's where the bug was visible.
        _write_note(
            root,
            "topics",
            "dup-source.md",
            {
                "id": "thr_dups01",
                "title": "Dup Source",
                "type": "topic",
                "tags": ["x"],
                "created": now_iso(),
                "modified": now_iso(),
                "author": "user",
                "status": "active",
                "history": [],
            },
            "## About\n\nSee [[alpha-topic]] for context.\n",
        )
        # Add the reverse link to alpha-topic so both sides are pre-wired.
        alpha_path = root / "threads" / "topics" / "alpha-topic.md"
        alpha_path.write_text(
            alpha_path.read_text().rstrip() + "\n\n[[dup-source]]\n",
            encoding="utf-8",
        )

        source_path = root / "threads" / "topics" / "dup-source.md"
        source_note = parse_note(source_path)
        source_body_before = source_note.body
        alpha_body_before = parse_note(alpha_path).body

        # Spider wants to add [[Alpha Topic]] — same target, different spelling.
        added = await apply_links(root, source_path, source_note, ["Alpha Topic"])

        # Both directions are already linked, so nothing should change.
        assert added == []
        assert parse_note(source_path).body == source_body_before, (
            "Forward link was duplicated:\n" + parse_note(source_path).body
        )
        assert parse_note(alpha_path).body == alpha_body_before, (
            "Backlink was duplicated:\n" + parse_note(alpha_path).body
        )


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

    @pytest.mark.asyncio
    async def test_daily_log_repairs_malformed_model_output(self, tmp_path: Path):
        """A weak model emits the wrong notes header, hallucinated note prose,
        preamble and a closing remark — all must be repaired before writing,
        and ``## Notes Referenced`` must reflect the *real* changelog notes."""
        from unittest.mock import AsyncMock

        root = _setup_vault(tmp_path)
        # Spider touched two real topic notes today (their Targets are real
        # note paths under threads/). Weaver archived a capture (excluded).
        log_action(
            root,
            "spider",
            "linked",
            str(root / "threads" / "topics" / "alpha-topic.md"),
            details="Suggested 3: Bob Kumar, Beta Topic, TCP/IP networking",
        )
        log_action(
            root,
            "spider",
            "linked",
            str(root / "threads" / "topics" / "beta-topic.md"),
            details="Auto-linked 1: Alpha Topic",
        )
        log_action(
            root,
            "weaver",
            "archived",
            str(root / "threads" / "captures" / "raw-inbox.md"),
            details="Archived processed capture -> raw-inbox.md",
        )

        malformed = (
            "Here is your daily log for today!\n\n"
            "## Summary\n\n"
            "We made good progress on distributed systems.\n\n"
            "## Notes\n\n"  # wrong section name
            "recognizing the strong correlation between 'Vector Database' and "
            "'Embeddings', I created [[alpha-topic.md]] and "
            "[[some-hallucinated-note.md]].\n\n"  # hallucinated, .md filenames
            "Let me know if you need anything else!\n"  # trailing remark
        )
        provider = AsyncMock()
        provider.chat = AsyncMock(return_value=malformed)
        scribe = Scribe(root, chat_provider=provider)

        utc_today = date.fromisoformat(now_iso()[:10])
        await scribe.generate_daily_log(utc_today)

        daily_path = root / "threads" / "daily" / f"{utc_today.isoformat()}.md"
        body = parse_note(daily_path).body

        # Exactly the required sections, correctly named.
        assert "## Summary" in body
        assert "## Activity" in body
        assert body.count("## Notes Referenced") == 1
        # The near-miss "## Notes" header was renamed, not left as-is.
        assert "## Notes\n" not in body
        # Notes Referenced holds the real touched notes, by title, deduped.
        assert "[[Alpha Topic]]" in body
        assert "[[Beta Topic]]" in body
        # None of the hallucinated content survived.
        assert "hallucinated" not in body
        assert "correlation" not in body
        assert "[[alpha-topic.md]]" not in body  # filename link replaced by title
        # Preamble and closing remark stripped.
        assert "Here is your daily log" not in body
        assert "Let me know if you need" not in body
        # The archived capture must not appear.
        assert "raw-inbox" not in body.lower()

    @pytest.mark.asyncio
    async def test_daily_log_notes_from_weaver_arrow_path(self, tmp_path: Path):
        """Weaver records the note it created only in its Details line, as a
        relative path after an arrow. That note must appear in Notes Referenced
        even though the Target is the captures/ folder."""
        from unittest.mock import AsyncMock

        root = _setup_vault(tmp_path)
        log_action(
            root,
            "weaver",
            "created",
            str(root / "threads" / "captures"),  # folder target — excluded
            details=("Processed capture 'meeting.md' -> projects/gamma-project.md"),
        )

        provider = AsyncMock()
        provider.chat = AsyncMock(return_value="## Summary\n\nDid work.\n")
        scribe = Scribe(root, chat_provider=provider)

        utc_today = date.fromisoformat(now_iso()[:10])
        await scribe.generate_daily_log(utc_today)

        daily_path = root / "threads" / "daily" / f"{utc_today.isoformat()}.md"
        body = parse_note(daily_path).body
        assert "[[Gamma Project]]" in body  # resolved from the arrow path

    @pytest.mark.asyncio
    async def test_fallback_emits_all_required_sections(self, tmp_path: Path):
        """Without a chat provider, the daily log still has Summary, Activity
        and a deterministic Notes Referenced built from the changelog."""
        root = _setup_vault(tmp_path)
        log_action(
            root,
            "spider",
            "linked",
            str(root / "threads" / "topics" / "alpha-topic.md"),
            details="Suggested 1: Beta Topic",
        )

        scribe = Scribe(root, chat_provider=None)
        utc_today = date.fromisoformat(now_iso()[:10])
        await scribe.generate_daily_log(utc_today)

        daily_path = root / "threads" / "daily" / f"{utc_today.isoformat()}.md"
        body = parse_note(daily_path).body
        assert "## Summary" in body
        assert "## Activity" in body
        assert "## Notes Referenced" in body
        assert "[[Alpha Topic]]" in body


# =============================================================================
# Scribe deterministic-notes helper tests (no LLM)
# =============================================================================


class TestScribeNotes:
    """Unit tests for the pure helpers behind Scribe's daily log."""

    @staticmethod
    def _changelog(root: Path, entries: list[str]) -> str:
        """Assemble a changelog string with real ``Target:`` paths."""
        return "\n".join(entries)

    def test_build_notes_resolves_titles_from_targets(self, tmp_path: Path):
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        alpha = root / "threads" / "topics" / "alpha-topic.md"
        beta = root / "threads" / "topics" / "beta-topic.md"
        changelog = (
            f"## ts1\n\n- **Agent:** spider\n- **Action:** linked\n"
            f"- **Target:** {alpha}\n- **Chain:** pass\n- **Details:** x\n\n"
            f"## ts2\n\n- **Agent:** sentinel\n- **Action:** validated\n"
            f"- **Target:** {beta}\n- **Chain:** pass\n- **Details:** y\n"
        )
        section = build_notes_referenced(changelog, root)
        assert section.startswith("## Notes Referenced")
        assert "[[Alpha Topic]]" in section
        assert "[[Beta Topic]]" in section
        # Sorted, one per line.
        assert section.index("[[Alpha Topic]]") < section.index("[[Beta Topic]]")

    def test_build_notes_excludes_captures_archive_and_folders(self, tmp_path: Path):
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        # A real note in captures/ and .archive/, plus folder + non-note targets.
        _write_note(
            root,
            "captures",
            "inbox-item.md",
            {
                "id": "thr_cap999",
                "title": "Inbox Item",
                "type": "capture",
                "tags": [],
                "created": now_iso(),
                "modified": now_iso(),
                "author": "user",
                "status": "active",
                "history": [],
            },
            "raw\n",
        )
        archived = root / "threads" / ".archive" / "old-note.md"
        archived.write_text(
            build_frontmatter(
                {
                    "id": "thr_arc999",
                    "title": "Old Note",
                    "type": "topic",
                    "tags": [],
                    "created": now_iso(),
                    "modified": now_iso(),
                    "author": "user",
                    "status": "archived",
                    "history": [],
                }
            )
            + "\nbody\n",
            encoding="utf-8",
        )
        alpha = root / "threads" / "topics" / "alpha-topic.md"
        changelog = (
            f"## a\n\n- **Agent:** weaver\n- **Action:** created\n"
            f"- **Target:** {root / 'threads' / 'captures'}\n- **Chain:** pass\n"
            f"- **Details:** Vault stuff\n\n"
            f"## b\n\n- **Agent:** weaver\n- **Action:** archived\n"
            f"- **Target:** {root / 'threads' / 'captures' / 'inbox-item.md'}\n"
            f"- **Chain:** pass\n- **Details:** archived\n\n"
            f"## c\n\n- **Agent:** archivist\n- **Action:** archived\n"
            f"- **Target:** {archived}\n- **Chain:** pass\n- **Details:** archived\n\n"
            f"## d\n\n- **Agent:** archivist\n- **Action:** audited\n"
            f"- **Target:** {root / 'threads'}\n- **Chain:** pass\n"
            f"- **Details:** Vault audit: 3 notes\n\n"
            f"## e\n\n- **Agent:** spider\n- **Action:** linked\n"
            f"- **Target:** {alpha}\n- **Chain:** pass\n- **Details:** x\n"
        )
        section = build_notes_referenced(changelog, root)
        assert "[[Alpha Topic]]" in section
        assert "Inbox Item" not in section
        assert "Old Note" not in section

    def test_build_notes_uses_weaver_arrow_path_not_prose(self, tmp_path: Path):
        """Only the post-arrow relative path in Details is treated as a note;
        path-shaped tokens elsewhere in prose are ignored."""
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        changelog = (
            f"## a\n\n- **Agent:** weaver\n- **Action:** created\n"
            f"- **Target:** {root / 'threads' / 'captures'}\n- **Chain:** pass\n"
            "- **Details:** Processed capture 'note.md' -> topics/beta-topic.md\n\n"
            f"## b\n\n- **Agent:** spider\n- **Action:** linked\n"
            f"- **Target:** {root / 'threads' / 'topics' / 'alpha-topic.md'}\n"
            "- **Chain:** pass\n"
            "- **Details:** Suggested: see docs/readme.md and projects/ignored.md here\n"
        )
        section = build_notes_referenced(changelog, root)
        assert "[[Beta Topic]]" in section  # from the arrow path
        assert "[[Alpha Topic]]" in section  # from the Target
        # The non-arrow path-shaped tokens in prose must not be picked up.
        assert "Readme" not in section
        assert "Ignored" not in section

    def test_build_notes_survives_malformed_frontmatter(self, tmp_path: Path):
        """A note with non-dict frontmatter must fall back to a humanized stem,
        never crash and abort the whole section."""
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        good = root / "threads" / "topics" / "alpha-topic.md"
        broken = root / "threads" / "topics" / "broken-note.md"
        broken.write_text("---\njust a bare string\n---\nbody\n", encoding="utf-8")
        changelog = (
            f"## a\n\n- **Agent:** spider\n- **Action:** linked\n"
            f"- **Target:** {good}\n- **Chain:** pass\n- **Details:** x\n\n"
            f"## b\n\n- **Agent:** spider\n- **Action:** linked\n"
            f"- **Target:** {broken}\n- **Chain:** pass\n- **Details:** y\n"
        )
        section = build_notes_referenced(changelog, root)
        assert "[[Alpha Topic]]" in section
        assert "[[Broken Note]]" in section  # humanized stem, not a crash

    def test_normalize_preserves_headerless_prose_as_summary(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        out = normalize_sections("I shipped the search pipeline today.", notes)
        assert "search pipeline" in out
        assert "## Summary" in out

    def test_build_notes_humanizes_unresolvable_path(self, tmp_path: Path):
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        # A note file with no frontmatter title -> humanized stem fallback.
        no_title = root / "threads" / "projects" / "my-cool-note.md"
        no_title.write_text("just body, no frontmatter\n", encoding="utf-8")
        changelog = (
            f"## a\n\n- **Agent:** spider\n- **Action:** linked\n"
            f"- **Target:** {no_title}\n- **Chain:** pass\n- **Details:** x\n"
        )
        section = build_notes_referenced(changelog, root)
        assert "[[My Cool Note]]" in section

    def test_build_notes_dedupes_across_target_and_arrow(self, tmp_path: Path):
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        beta = root / "threads" / "topics" / "beta-topic.md"
        changelog = (
            f"## a\n\n- **Agent:** weaver\n- **Action:** created\n"
            f"- **Target:** {root / 'threads' / 'captures'}\n- **Chain:** pass\n"
            "- **Details:** Processed capture 'x.md' -> topics/beta-topic.md\n\n"
            f"## b\n\n- **Agent:** spider\n- **Action:** linked\n"
            f"- **Target:** {beta}\n- **Chain:** pass\n- **Details:** y\n"
        )
        section = build_notes_referenced(changelog, root)
        assert section.count("[[Beta Topic]]") == 1

    def test_build_notes_excludes_self_note(self, tmp_path: Path):
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        utc_today = now_iso()[:10]
        own = root / "threads" / "daily" / f"{utc_today}.md"
        own.write_text(
            build_frontmatter(
                {
                    "id": "thr_self00",
                    "title": utc_today,
                    "type": "daily",
                    "tags": [],
                    "created": now_iso(),
                    "modified": now_iso(),
                    "author": "agent:scribe",
                    "status": "active",
                    "history": [],
                }
            )
            + "\nbody\n",
            encoding="utf-8",
        )
        changelog = (
            f"## a\n\n- **Agent:** scribe\n- **Action:** created\n"
            f"- **Target:** {own}\n- **Chain:** pass\n- **Details:** Daily log\n"
        )
        section = build_notes_referenced(changelog, root, self_note=f"{utc_today}.md")
        assert utc_today not in section
        assert "No notes touched today" in section

    def test_build_notes_empty_changelog_placeholder(self, tmp_path: Path):
        from agents.loom.scribe_notes import build_notes_referenced

        root = _setup_vault(tmp_path)
        section = build_notes_referenced("", root)
        assert section.startswith("## Notes Referenced")
        assert "No notes touched today" in section

    def test_normalize_renames_near_miss_headers(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        body = "## Summary:\n\nDid things.\n\n## Notes\n\nhallucinated list\n"
        out = normalize_sections(body, notes)
        assert "## Summary\n" in out
        assert "## Summary:" not in out
        assert out.count("## Notes Referenced") == 1
        assert "## Notes\n" not in out
        assert "[[Alpha]]" in out
        assert "hallucinated" not in out

    def test_normalize_inserts_missing_required_sections(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        out = normalize_sections("## Summary\n\nA summary only.\n", notes)
        assert "## Summary" in out
        assert "## Activity" in out
        assert "## Notes Referenced" in out

    def test_normalize_strips_preamble_and_trailing(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        body = (
            "Hello, here is your log!\n\n"
            "## Summary\n\nWork done.\n\n"
            "## Activity\n\n- did stuff\n\n"
            "Thanks, bye!\n"
        )
        out = normalize_sections(body, notes)
        assert "Hello, here is your log" not in out
        assert "Thanks, bye" not in out
        assert out.strip().startswith("## Summary")

    def test_normalize_keeps_optional_themes_in_order(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        body = (
            "## Activity\n\n- did stuff\n\n"
            "## Themes\n\n- distributed systems\n\n"
            "## Summary\n\nGood day.\n"
        )
        out = normalize_sections(body, notes)
        # Canonical order: Summary, Themes, Activity, Notes Referenced.
        assert (
            out.index("## Summary")
            < out.index("## Themes")
            < out.index("## Activity")
            < out.index("## Notes Referenced")
        )

    def test_normalize_handles_no_headers(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        out = normalize_sections("just prose, no headers at all", notes)
        assert "## Summary" in out
        assert "## Activity" in out
        assert "## Notes Referenced" in out

    def test_normalize_is_idempotent(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        body = "preamble\n## Notes\nbad\n## Summary\nS\n"
        once = normalize_sections(body, notes)
        twice = normalize_sections(once, notes)
        assert once == twice

    def test_normalize_ignores_fenced_pseudo_headers(self):
        from agents.loom.scribe_notes import normalize_sections

        notes = "## Notes Referenced\n\n[[Alpha]]\n"
        body = (
            "## Summary\n\nDid work.\n\n"
            "```\n## Activity\nthis is fenced, not a real header\n```\n\n"
            "## Activity\n\n- the real activity\n"
        )
        out = normalize_sections(body, notes)
        # The real Activity content wins; the fenced one didn't replace it.
        assert "- the real activity" in out

    def test_summarize_activity_skips_noise(self):
        from agents.loom.scribe_notes import summarize_changelog_activity

        changelog = (
            "## a\n\n- **Agent:** spider\n- **Action:** scanned\n"
            "- **Target:** /v/threads/topics/x.md\n- **Chain:** pass\n- **Details:** d\n\n"
            "## b\n\n- **Agent:** weaver\n- **Action:** created\n"
            "- **Target:** /v/threads/topics/y.md\n- **Chain:** pass\n- **Details:** d\n"
        )
        out = summarize_changelog_activity(changelog)
        assert "weaver created" in out
        assert "scanned" not in out  # noise action filtered


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

    @pytest.mark.asyncio
    async def test_reports_mode_deterministic_only_when_no_provider(self, tmp_path: Path):
        """Without a chat provider, modes show deterministic+llm_unavailable."""
        root = _setup_vault(tmp_path)
        sentinel = Sentinel(root, chat_provider=None)

        from agents.chain import ReadChain

        chain = ReadChain(root)
        chain_result = chain.execute("weaver", root / "threads" / "topics" / "alpha-topic.md")

        result = await sentinel.validate_action(
            "weaver", "created", root / "threads" / "topics" / "alpha-topic.md", chain_result
        )

        assert "deterministic" in result.modes
        assert "llm_unavailable" in result.modes
        assert "llm" not in result.modes
        # The changelog details should contain the mode summary so readers
        # can tell which validation actually ran.
        changelog_dir = root / ".loom" / "changelog" / "sentinel"
        content = next(changelog_dir.glob("*.md")).read_text(encoding="utf-8")
        assert "deterministic+llm_unavailable" in content

    @pytest.mark.asyncio
    async def test_reports_mode_llm_when_provider_succeeds(self, tmp_path: Path):
        """With a working chat provider, modes include 'llm'."""
        from unittest.mock import AsyncMock

        root = _setup_vault(tmp_path)
        provider = AsyncMock()
        provider.chat = AsyncMock(
            return_value="status: passed\nreasons:\n- Content respects principles\n"
        )
        sentinel = Sentinel(root, chat_provider=provider)

        from agents.chain import ReadChain

        chain = ReadChain(root)
        chain_result = chain.execute("weaver", root / "threads" / "topics" / "alpha-topic.md")

        result = await sentinel.validate_action(
            "weaver", "created", root / "threads" / "topics" / "alpha-topic.md", chain_result
        )

        assert "deterministic" in result.modes
        assert "llm" in result.modes
        assert "llm_unavailable" not in result.modes
        assert result.mode_summary == "deterministic+llm"


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
        # Default sentinel verdict (no LLM) is 'passed' — capture should
        # have been archived by the runner's enforcement step.
        assert result.capture_archived
        assert not capture_path.exists()

    @pytest.mark.asyncio
    async def test_failed_sentinel_keeps_capture_in_inbox(self, tmp_path: Path):
        """Regression: when Sentinel returns 'failed' the capture must NOT
        be archived. It stays in captures/ so the user sees it needs review."""
        from unittest.mock import AsyncMock, patch

        from agents.loom.archivist import init_archivist
        from agents.loom.scribe import init_scribe
        from agents.loom.sentinel import init_sentinel
        from agents.loom.spider import init_spider
        from agents.loom.weaver import init_weaver
        from agents.runner import AgentRunner

        root = _setup_vault(tmp_path)
        capture_path = _write_note(
            root,
            "captures",
            "cap-fail.md",
            {
                "id": "thr_cfail0",
                "title": "Will fail",
                "type": "capture",
                "tags": ["inbox"],
                "created": now_iso(),
                "modified": now_iso(),
                "author": "user",
                "source": "manual",
                "status": "active",
                "history": [],
            },
            "Capture that Sentinel will fail.\n",
        )

        init_weaver(root, chat_provider=None)
        init_spider(root, chat_provider=None)
        init_archivist(root, chat_provider=None)
        init_scribe(root, chat_provider=None)
        init_sentinel(root, chat_provider=None)

        runner = AgentRunner(root)

        # Force sentinel to return 'failed' by patching validate_action.
        fake_validation = ValidationResult(
            status="failed",
            reasons=["mock failure for test"],
            agent_name="weaver",
            action="created",
        )
        with patch.object(Sentinel, "validate_action", new=AsyncMock(return_value=fake_validation)):
            result = await runner.run_pipeline(capture_path)

        # Note still got created — we can't un-call the LLM. But the
        # capture stays in inbox so the user can see something's wrong.
        assert result.note is not None
        assert result.validation is not None
        assert result.validation.status == "failed"
        assert not result.capture_archived
        assert capture_path.exists(), "Capture should stay in inbox on Sentinel-failed"

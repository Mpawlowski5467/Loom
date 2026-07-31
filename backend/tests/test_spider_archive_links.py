"""Regression tests: Spider must never link to, suggest, or write into archived notes.

Background: the file watcher's create/modify handlers call
``NoteIndex.refresh_file`` without filtering ``.archive/`` (unlike ``build``
and ``move_file``), so a note archived mid-pipeline (e.g. a capture
enforce-archived after a failed Sentinel verdict, then referenced by the
retry's note) lingers in the index under its ``threads/.archive/`` path.
Spider's disk-side lookups all filter ``.archive``; these tests pin the same
behavior for the index-side lookups and for the backlink write path, which
used to die with ``VaultIOError: Refusing to write into .archive/`` once per
scan.
"""

from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from agents.loom.spider import Spider
from agents.loom.spider_candidates import find_candidates
from agents.loom.spider_linker import apply_links
from agents.loom.spider_lookup import build_title_map, list_vault_notes, resolve_title
from core.note_index import get_note_index
from core.notes import build_frontmatter, now_iso, parse_note


def _setup_vault(tmp_path: Path) -> Path:
    """Create a minimal vault that passes Spider's read-before-write chain."""
    root = tmp_path / "vault"
    root.mkdir()
    (root / "vault.yaml").write_text(yaml.safe_dump({"name": "test"}), encoding="utf-8")
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nBe good. Log every action.\n", encoding="utf-8")
    agent_dir = root / "agents" / "spider"
    agent_dir.mkdir(parents=True)
    (agent_dir / "config.yaml").write_text(
        yaml.safe_dump({"name": "spider", "enabled": True, "trust_level": "standard"}),
        encoding="utf-8",
    )
    (agent_dir / "memory.md").write_text("# Memory\n\nEmpty.\n", encoding="utf-8")
    (agent_dir / "logs").mkdir()
    for folder in ["topics", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True, exist_ok=True)
    return root


def _meta(note_id: str, title: str, tags: list[str], note_type: str = "topic") -> dict:
    ts = now_iso()
    return {
        "id": note_id,
        "title": title,
        "type": note_type,
        "tags": tags,
        "created": ts,
        "modified": ts,
        "author": "user",
        "status": "active",
        "history": [],
    }


def _write_note(root: Path, folder: str, filename: str, meta: dict, body: str) -> Path:
    path = root / "threads" / folder / filename
    path.write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return path


def _leak_archived_into_index(root: Path) -> None:
    """Simulate the watcher leak: ``refresh_file`` indexes notes under
    ``.archive/`` because the create/modify handlers don't filter it."""
    index = get_note_index()
    index.build(root / "threads")
    for md in (root / "threads" / ".archive").rglob("*.md"):
        index.refresh_file(md)
    leaked = [e for e in index.all_entries() if ".archive" in e.file_path.parts]
    assert leaked, "simulation broken: NoteIndex no longer accepts .archive entries"


# =============================================================================
# Backlink write path
# =============================================================================


class TestArchivedBacklinkTargets:
    @pytest.mark.asyncio
    async def test_apply_links_links_live_and_skips_archived(self, tmp_path: Path):
        """An archived path in the title map (stale/leaked entry) must be
        skipped silently — live targets in the same batch still get linked."""
        root = _setup_vault(tmp_path)
        source_path = _write_note(
            root,
            "topics",
            "source-note.md",
            _meta("thr_src001", "Source Note", ["loom"]),
            "Source body.\n",
        )
        live_path = _write_note(
            root,
            "topics",
            "live-target.md",
            _meta("thr_live01", "Live Target", ["loom"]),
            "Live body.\n",
        )
        archived_path = _write_note(
            root,
            ".archive",
            "archived-capture.md",
            _meta("thr_arch01", "Archived Capture", ["loom"], "capture"),
            "Failed first attempt.\n",
        )
        archived_before = archived_path.read_text(encoding="utf-8")

        stale_map = {"archived capture": archived_path, "live target": live_path}
        with patch("agents.loom.spider_linker.build_title_map", return_value=stale_map):
            linked = await apply_links(
                root, source_path, parse_note(source_path), ["Archived Capture", "Live Target"]
            )

        assert linked == ["Live Target"]
        assert archived_path.read_text(encoding="utf-8") == archived_before
        assert "Live Target" in parse_note(source_path).wikilinks
        assert "Source Note" in parse_note(live_path).wikilinks

    @pytest.mark.asyncio
    async def test_apply_links_with_leaked_index_skips_archived(self, tmp_path: Path):
        """End-to-end through the real (leaked) NoteIndex: the archived note
        is indexed, yet no backlink write is attempted and nothing changes."""
        root = _setup_vault(tmp_path)
        source_path = _write_note(
            root,
            "topics",
            "source-note.md",
            _meta("thr_src001", "Source Note", ["loom"]),
            "Source body.\n",
        )
        archived_path = _write_note(
            root,
            ".archive",
            "archived-capture.md",
            _meta("thr_arch01", "Archived Capture", ["loom"], "capture"),
            "Failed first attempt.\n",
        )
        _leak_archived_into_index(root)
        source_before = source_path.read_text(encoding="utf-8")
        archived_before = archived_path.read_text(encoding="utf-8")

        linked = await apply_links(root, source_path, parse_note(source_path), ["Archived Capture"])

        assert linked == []
        assert source_path.read_text(encoding="utf-8") == source_before
        assert archived_path.read_text(encoding="utf-8") == archived_before


# =============================================================================
# Full scan: new note referencing an archived note
# =============================================================================


class TestScanWithArchivedReference:
    @pytest.mark.asyncio
    async def test_scan_note_linking_archived_note_succeeds(self, tmp_path: Path):
        """The reported bug: a retry note references its superseded (now
        archived) predecessor with a kebab-case wikilink. The scan must
        complete, process live connections, and never touch the archive."""
        root = _setup_vault(tmp_path)
        _write_note(
            root,
            "topics",
            "live-sibling.md",
            _meta("thr_live01", "Live Sibling", ["loom"]),
            "Live sibling body.\n",
        )
        archived_path = _write_note(
            root,
            ".archive",
            "superseded-capture.md",
            _meta("thr_arch01", "Superseded Capture", ["loom"], "capture"),
            "Failed first attempt.\n",
        )
        new_path = _write_note(
            root,
            "captures",
            "retry-note.md",
            _meta("thr_retry1", "Retry Note", ["loom"], "capture"),
            "Retry body.\n\nSupersedes [[superseded-capture]].\n",
        )
        _leak_archived_into_index(root)
        archived_before = archived_path.read_text(encoding="utf-8")

        spider = Spider(root, chat_provider=None)
        report = await spider.scan_and_report(new_path)

        # Note still processed: the live tag-overlap sibling gets linked.
        assert report.error == ""
        assert "Live Sibling" in report.auto_linked
        # The archived note is never linked, suggested, or even a candidate.
        assert "Superseded Capture" not in report.auto_linked
        assert "Superseded Capture" not in report.suggested
        assert all(c.title != "Superseded Capture" for c in report.candidates)
        assert archived_path.read_text(encoding="utf-8") == archived_before

        # No action-failure entries in the spider changelog.
        changelog_dir = root / ".loom" / "changelog" / "spider"
        changelog = "\n".join(p.read_text(encoding="utf-8") for p in changelog_dir.glob("*.md"))
        assert "Action failed" not in changelog


# =============================================================================
# Candidate discovery (also feeds suggested links / inbox preview)
# =============================================================================


class TestCandidatesExcludeArchived:
    @pytest.mark.asyncio
    async def test_vector_candidates_exclude_archived_notes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        """A vector-search hit pointing at an archived note (still in the
        vector store / leaked index) must be dropped, not linked or suggested."""
        root = _setup_vault(tmp_path)
        source_path = _write_note(
            root,
            "captures",
            "retry-note.md",
            _meta("thr_retry1", "Retry Note", ["loom"], "capture"),
            "Retry body.\n",
        )
        _write_note(
            root,
            "topics",
            "live-vector.md",
            _meta("thr_live02", "Live Vector Target", ["loom"]),
            "Live body.\n",
        )
        _write_note(
            root,
            ".archive",
            "archived-capture.md",
            _meta("thr_arch01", "Archived Capture", ["loom"], "capture"),
            "Failed first attempt.\n",
        )
        _leak_archived_into_index(root)

        class _Result:
            def __init__(self, note_id: str, score: float) -> None:
                self.note_id = note_id
                self.score = score

        class _FakeSearcher:
            async def search(self, query, context_note_ids=None, limit=10):
                return [_Result("thr_arch01", 0.95), _Result("thr_live02", 0.90)]

        monkeypatch.setattr("index.searcher.get_searcher", lambda: _FakeSearcher())

        candidates = await find_candidates(root, parse_note(source_path), set(), None)

        titles = [c.title for c in candidates]
        assert "Live Vector Target" in titles
        assert "Archived Capture" not in titles

    def test_index_side_lookups_exclude_archived_entries(self, tmp_path: Path):
        """Pin the index branches of the spider_lookup helpers: they must
        filter .archive exactly like their disk-scan fallbacks."""
        root = _setup_vault(tmp_path)
        live_path = _write_note(
            root,
            "topics",
            "live-note.md",
            _meta("thr_live01", "Live Note", ["loom"]),
            "Live body.\n",
        )
        _write_note(
            root,
            ".archive",
            "archived-capture.md",
            _meta("thr_arch01", "Archived Capture", ["loom"], "capture"),
            "Failed first attempt.\n",
        )
        _leak_archived_into_index(root)

        threads_dir = root / "threads"
        assert resolve_title(root, "thr_arch01") == ""
        assert resolve_title(root, "thr_live01") == "Live Note"

        title_map = build_title_map(threads_dir)
        assert "archived capture" not in title_map
        assert title_map["live note"] == live_path

        ids = {n["id"] for n in list_vault_notes(threads_dir)}
        assert "thr_arch01" not in ids
        assert "thr_live01" in ids

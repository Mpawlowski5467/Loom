"""Tests for wikilink target canonicalization — unicode dash/space variants.

Local models sometimes emit unicode dashes (observed: gpt-oss writing U+2011
NON-BREAKING HYPHEN for '-') or non-breaking spaces inside ``[[wikilink]]``
targets, which silently breaks resolution against the real ASCII note names.
``core.notes`` normalizes these variants at extraction (read layer, so notes
written before the fix still resolve) and Weaver/Scribe normalize bodies
before writing (write layer, so stored content is canonical). Prose outside
``[[...]]`` is never touched.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import yaml

from agents.changelog import log_action
from agents.loom.scribe import Scribe
from agents.loom.weaver import Weaver
from core.graph import build_graph
from core.notes import (
    build_frontmatter,
    normalize_wikilink_target,
    normalize_wikilinks_in_body,
    now_iso,
    parse_note,
)
from tests.test_agent_pipeline import _build_vault, _write_capture

NB_HYPHEN = "\u2011"  # NON-BREAKING HYPHEN — the variant observed in the wild.
NBSP = "\u00a0"  # NO-BREAK SPACE

_DASH_VARIANTS = [
    "\u2010",  # HYPHEN
    NB_HYPHEN,
    "\u2012",  # FIGURE DASH
    "\u2013",  # EN DASH
    "\u2014",  # EM DASH
    "\u2015",  # HORIZONTAL BAR
    "\u2212",  # MINUS SIGN
    "\ufe58",  # SMALL EM DASH
    "\ufe63",  # SMALL HYPHEN-MINUS
    "\uff0d",  # FULLWIDTH HYPHEN-MINUS
]

_SPACE_VARIANTS = [
    NBSP,
    "\u202f",  # NARROW NO-BREAK SPACE
    "\u2009",  # THIN SPACE
]


def _write_note(root: Path, folder: str, filename: str, meta: dict, body: str) -> Path:
    path = root / "threads" / folder / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return path


def _meta(note_id: str, title: str, note_type: str = "topic") -> dict:
    ts = now_iso()
    return {
        "id": note_id,
        "title": title,
        "type": note_type,
        "tags": [],
        "created": ts,
        "modified": ts,
        "author": "user",
        "status": "active",
        "history": [],
    }


def _scaffold_agent(root: Path, name: str) -> None:
    """Create the agent dirs ``execute_with_chain`` persists state under."""
    agent_dir = root / "agents" / name
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "config.yaml").write_text(
        yaml.safe_dump(
            {"name": name, "enabled": True, "trust_level": "standard", "memory_threshold": 100}
        ),
        encoding="utf-8",
    )
    (agent_dir / "memory.md").write_text("# Memory\n", encoding="utf-8")
    (agent_dir / "state.json").write_text(
        json.dumps({"action_count": 0, "last_action": None}), encoding="utf-8"
    )
    (agent_dir / "logs").mkdir(exist_ok=True)
    (root / ".loom" / "changelog" / name).mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Unit: the mapping itself
# ---------------------------------------------------------------------------


class TestNormalizeWikilinkTarget:
    @pytest.mark.parametrize("dash", _DASH_VARIANTS)
    def test_each_dash_variant_becomes_ascii_hyphen(self, dash: str) -> None:
        assert normalize_wikilink_target(f"loom{dash}capture{dash}cli") == "loom-capture-cli"

    @pytest.mark.parametrize("space", _SPACE_VARIANTS)
    def test_each_space_variant_becomes_ascii_space(self, space: str) -> None:
        assert normalize_wikilink_target(f"Alpha{space}Topic") == "Alpha Topic"

    def test_alias_target_normalized_alias_preserved(self) -> None:
        # The target is an identifier; the alias is display text and keeps
        # its original typography (em-dash and NBSP survive there).
        assert (
            normalize_wikilink_target(f"loom{NB_HYPHEN}cli|an — alias{NBSP}text")
            == f"loom-cli|an — alias{NBSP}text"
        )

    def test_ascii_target_unchanged(self) -> None:
        assert normalize_wikilink_target("projects/loom-capture-cli") == (
            "projects/loom-capture-cli"
        )


class TestNormalizeWikilinksInBody:
    def test_prose_dashes_and_spaces_untouched(self) -> None:
        prose = f"Prose — with an em-dash, an \u2013 en-dash, and a{NBSP}non-breaking space."
        body = (
            f"{prose}\n\nSee [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli]] and [[Alpha{NBSP}Topic]].\n"
        )
        out = normalize_wikilinks_in_body(body)
        # Link targets canonicalized...
        assert "[[loom-capture-cli]]" in out
        assert "[[Alpha Topic]]" in out
        # ...prose untouched.
        assert prose in out
        assert NB_HYPHEN not in out

    def test_idempotent(self) -> None:
        body = f"See [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli|a — tool]].\n"
        once = normalize_wikilinks_in_body(body)
        assert normalize_wikilinks_in_body(once) == once


# ---------------------------------------------------------------------------
# Read layer: extraction normalizes legacy notes
# ---------------------------------------------------------------------------


class TestReadLayer:
    def test_legacy_unicode_link_extracts_same_target_as_ascii(self, tmp_path: Path) -> None:
        legacy = _write_note(
            tmp_path,
            "daily",
            "legacy.md",
            _meta("thr_leg001", "Legacy", "daily"),
            f"Filed [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli]] today.\n",
        )
        ascii_note = _write_note(
            tmp_path,
            "daily",
            "ascii.md",
            _meta("thr_asc001", "Ascii", "daily"),
            "Filed [[loom-capture-cli]] today.\n",
        )
        assert (
            parse_note(legacy).wikilinks == parse_note(ascii_note).wikilinks == ["loom-capture-cli"]
        )

    def test_graph_resolves_legacy_unicode_link(self, tmp_path: Path) -> None:
        threads = tmp_path / "threads"
        _write_note(
            tmp_path,
            "projects",
            "loom-capture-cli.md",
            _meta("thr_tgt001", "Loom Capture CLI", "project"),
            "## Overview\n\nA tool.\n",
        )
        # A legacy daily note (pre-fix) links by kebab slug with U+2011 and
        # by title with U+00A0 — both must resolve to the target note.
        _write_note(
            tmp_path,
            "daily",
            "2026-07-26.md",
            _meta("thr_day001", "2026-07-26", "daily"),
            f"Filed [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli]] and [[Loom{NBSP}Capture{NBSP}CLI]].\n",
        )

        graph = build_graph(threads)
        edge_pairs = {(e.source, e.target) for e in graph.edges}
        assert ("thr_day001", "thr_tgt001") in edge_pairs


# ---------------------------------------------------------------------------
# Write layer: Weaver stores canonical links
# ---------------------------------------------------------------------------


class TestWeaverWriteLayer:
    @staticmethod
    def _stub_chat() -> AsyncMock:
        """A chat provider that classifies as a topic and emits U+2011 links."""
        chat = AsyncMock()
        chat.chat = AsyncMock(
            side_effect=[
                "type: topic\nfolder: topics\ntitle: Capture CLI\ntags: cli",
                "## Summary\n\n"
                f"Filed [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli{NB_HYPHEN}for{NB_HYPHEN}stdin]]"
                " — a small tool.\n\n"
                "## Details\n\n"
                f"See [[Alpha{NBSP}Topic]] for context.\n",
            ]
        )
        return chat

    @pytest.mark.asyncio
    async def test_process_capture_stores_canonical_links(self, tmp_path: Path) -> None:
        root = _build_vault(tmp_path)
        capture_path = _write_capture(root, "cap-uni.md", "Unicode Links", "CLI capture.\n")

        weaver = Weaver(root, chat_provider=self._stub_chat())
        note = await weaver.process_capture(capture_path)

        # The stored file is canonical: no unicode variants anywhere in it.
        raw = Path(note.file_path).read_text(encoding="utf-8")
        assert NB_HYPHEN not in raw
        assert "[[loom-capture-cli-for-stdin]]" in raw
        assert "[[Alpha Topic]]" in raw
        # Prose typography survives — only [[...]] contents were touched.
        assert " — a small tool." in raw
        # Extraction agrees.
        assert "loom-capture-cli-for-stdin" in note.wikilinks

    @pytest.mark.asyncio
    async def test_preview_proposal_body_is_canonical(self, tmp_path: Path) -> None:
        root = _build_vault(tmp_path)
        capture_path = _write_capture(root, "cap-uni.md", "Unicode Links", "CLI capture.\n")

        weaver = Weaver(root, chat_provider=self._stub_chat())
        proposal = await weaver.propose_capture(capture_path)

        assert proposal is not None
        assert NB_HYPHEN not in proposal.body
        assert "[[loom-capture-cli-for-stdin]]" in proposal.body


# ---------------------------------------------------------------------------
# Write layer: Scribe stores canonical links
# ---------------------------------------------------------------------------


class TestScribeWriteLayer:
    @pytest.mark.asyncio
    async def test_daily_log_normalizes_model_links(self, tmp_path: Path) -> None:
        root = _build_vault(tmp_path)
        _scaffold_agent(root, "scribe")
        target = _write_note(
            root,
            "projects",
            "loom-capture-cli.md",
            _meta("thr_tgt001", "Loom Capture CLI", "project"),
            "## Overview\n\nA tool.\n",
        )
        log_action(root, "weaver", "created", str(target), details="Filed the CLI note")

        chat = AsyncMock()
        chat.chat = AsyncMock(
            return_value=(
                "## Summary\n\n"
                f"Weaver filed [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli]] — the CLI note.\n\n"
                "## Activity\n\n"
                f"- weaver created [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli]]\n"
            )
        )
        scribe = Scribe(root, chat_provider=chat)

        utc_today = date.fromisoformat(now_iso()[:10])
        await scribe.generate_daily_log(utc_today)

        raw = (root / "threads" / "daily" / f"{utc_today.isoformat()}.md").read_text(
            encoding="utf-8"
        )
        assert NB_HYPHEN not in raw
        assert "[[loom-capture-cli]]" in raw
        # Prose em-dash outside the wikilinks survives.
        assert " — the CLI note." in raw
        # The deterministic notes section still lists the real note.
        assert "[[Loom Capture CLI]]" in raw

    @pytest.mark.asyncio
    async def test_folder_index_normalizes_model_links(self, tmp_path: Path) -> None:
        root = _build_vault(tmp_path)
        _scaffold_agent(root, "scribe")
        _write_note(
            root,
            "projects",
            "loom-capture-cli.md",
            _meta("thr_tgt001", "Loom Capture CLI", "project"),
            "## Overview\n\nA tool.\n",
        )

        chat = AsyncMock()
        chat.chat = AsyncMock(
            return_value=f"One project lives here: [[loom{NB_HYPHEN}capture{NB_HYPHEN}cli]].\n"
        )
        scribe = Scribe(root, chat_provider=chat)

        await scribe.update_index(root / "threads" / "projects")

        raw = (root / "threads" / "projects" / "_index.md").read_text(encoding="utf-8")
        assert NB_HYPHEN not in raw
        assert "[[loom-capture-cli]]" in raw

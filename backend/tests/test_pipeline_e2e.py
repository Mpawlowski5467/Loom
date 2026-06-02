"""True end-to-end pipeline test: capture → Weaver → index → search.

Every other backend test mocks the chat provider in isolation; the Docker
smoke test only curls /health. Nothing proves the whole chain *composes*.
This test drives ``AgentRunner.run_pipeline`` with deterministic stub chat +
embed providers, then indexes and searches the produced note, asserting it is
discoverable with correct frontmatter and wikilinks — and (since Items 2 & 3
landed) that reconciliation finds no drift and a re-run creates no duplicate.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from agents.loom.scribe import init_scribe
from agents.loom.sentinel import init_sentinel
from agents.loom.spider import init_spider
from agents.loom.weaver import init_weaver
from agents.runner import init_runner
from core.note_index import get_note_index
from core.notes import parse_note_meta
from index.indexer import init_indexer, unindexed_note_ids
from index.searcher import init_searcher

# Reuse the vault scaffold + capture writer from the Weaver pipeline tests.
from tests.test_agent_pipeline import _build_vault, _write_capture
from tests.test_pipeline_idempotency import _scaffold_all_agents

_EMBED_DIM = 16


@pytest.fixture(autouse=True)
def _reset_singletons():
    """Isolate module-level note index / indexer / searcher per test."""
    from core import note_index as ni_mod
    from index import indexer as idx_mod
    from index import searcher as srch_mod

    idx_mod.reset_indexer()
    srch_mod.reset_searcher()
    prev_ni = ni_mod._note_index
    ni_mod._note_index = None
    yield
    idx_mod.reset_indexer()
    srch_mod.reset_searcher()
    ni_mod._note_index = None
    ni_mod._note_index = prev_ni


def _stub_chat() -> AsyncMock:
    """A chat provider that classifies as a topic and emits a wikilinked body."""
    chat = AsyncMock()
    chat.chat = AsyncMock(
        side_effect=[
            "type: topic\nfolder: topics\ntitle: Raft Consensus\ntags: distributed, consensus",
            "## Summary\n\nRaft is a consensus algorithm.\n\n"
            "## Details\n\nElects a leader; see [[Paxos]] for contrast.\n\n"
            "## References\n\n- [[Distributed Systems]]\n",
        ]
    )
    return chat


def _stub_embed() -> AsyncMock:
    """An embedder returning a fixed-dimension constant vector.

    LanceDB fixes the vector dimension on first insert, so it must stay
    constant across every call within a test.
    """
    embed = AsyncMock()
    embed.embed = AsyncMock(return_value=[0.1] * _EMBED_DIM)
    return embed


class TestPipelineEndToEnd:
    @pytest.mark.asyncio
    async def test_capture_to_search_composes(self, tmp_path: Path) -> None:
        """A capture flows through the pipeline and becomes searchable."""
        root = _build_vault(tmp_path)
        _scaffold_all_agents(root)
        loom_dir = root / ".loom"

        # Wire indexer + searcher with stubs (no real provider/network).
        embed = _stub_embed()
        indexer = init_indexer(loom_dir, embed)
        init_searcher(indexer, embed, graph=None)

        # Seed the singleton agents the runner pulls + the runner itself.
        get_note_index().build(root / "threads")
        init_weaver(root, _stub_chat())
        init_spider(root, None)
        init_scribe(root, None)
        init_sentinel(root, None)
        runner = init_runner(root)

        capture_path = _write_capture(
            root, "cap-raft.md", "Raft notes", "Notes on the Raft consensus protocol.\n"
        )
        capture_id = parse_note_meta(capture_path).id

        # --- Drive the full pipeline. ---
        result = await runner.run_pipeline(capture_path)

        assert result.success, result.errors
        assert result.note is not None
        note = result.note
        assert note.type == "topic"
        assert note.title == "Raft Consensus"
        assert "consensus" in note.tags
        assert note.source == f"capture:{capture_id}"
        assert result.capture_archived is True
        assert not capture_path.exists()  # archived

        # The note body carries the wikilinks the LLM produced.
        assert "Paxos" in note.wikilinks

        # The watcher isn't running in-test — index the note explicitly, then
        # refresh the metadata index (the watcher would do both live).
        note_path = Path(note.file_path)
        chunk_count = await indexer.index_note(note_path)
        assert chunk_count > 0
        get_note_index().build(root / "threads")

        # --- Search finds the produced note. ---
        from index.searcher import get_searcher

        searcher = get_searcher()
        assert searcher is not None
        results = await searcher.search("raft consensus algorithm", limit=10)

        assert any(r.note_id == note.id for r in results)
        hit = next(r for r in results if r.note_id == note.id)
        assert hit.note_type == "topic"
        assert "consensus" in hit.tags

        # --- Items 2 & 3: reconciliation finds no drift; re-run no-ops. ---
        assert unindexed_note_ids() == []

        result2 = await runner.run_pipeline(capture_path)
        # Capture already archived (file gone) → idempotent no-op, no new note.
        assert result2.note is None
        notes_from_capture = [
            md
            for md in (root / "threads").rglob("*.md")
            if ".archive" not in md.parts and _safe_source(md) == f"capture:{capture_id}"
        ]
        assert len(notes_from_capture) == 1


def _safe_source(path: Path) -> str:
    try:
        return parse_note_meta(path).source
    except (OSError, ValueError):
        return ""

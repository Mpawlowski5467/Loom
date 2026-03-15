"""Tests for index/searcher.py — hybrid search with graph-aware boosting."""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from core.graph import GraphEdge, GraphNode, VaultGraph
from core.notes import build_frontmatter
from index.indexer import VectorIndexer
from index.searcher import VectorSearcher


@pytest.fixture
def tmp_vault(tmp_path):
    threads = tmp_path / "threads" / "topics"
    threads.mkdir(parents=True)
    loom = tmp_path / ".loom"
    loom.mkdir()
    return tmp_path


@pytest.fixture
def fake_embed():
    """Embed provider returning deterministic vectors based on content."""
    provider = AsyncMock()
    # Return a different vector each time to simulate real embeddings,
    # but keep them similar enough to find results
    call_count = 0

    async def _embed(text: str):
        nonlocal call_count
        call_count += 1
        # Base vector with slight variation per call
        vec = [0.5] * 16
        vec[call_count % 16] = 1.0
        return vec

    provider.embed = _embed
    return provider


def _write_note(base: Path, filename: str, title: str, body: str, note_type: str = "topic",
                tags: list[str] | None = None, note_id: str | None = None) -> Path:
    nid = note_id or f"thr_{filename[:6]}"
    meta = {
        "id": nid,
        "title": title,
        "type": note_type,
        "tags": tags or [],
        "status": "active",
    }
    path = base / "threads" / "topics" / filename
    path.write_text(build_frontmatter(meta) + "\n" + body, encoding="utf-8")
    return path


@pytest.fixture
def sample_graph():
    """Graph where hub connects to spoke1 and spoke2."""
    return VaultGraph(
        nodes=[
            GraphNode(id="thr_hub000", title="Hub", type="project", link_count=2),
            GraphNode(id="thr_spoke1", title="Spoke 1", type="topic", link_count=1),
            GraphNode(id="thr_spoke2", title="Spoke 2", type="topic", link_count=1),
            GraphNode(id="thr_island", title="Island", type="topic", link_count=0),
        ],
        edges=[
            GraphEdge(source="thr_hub000", target="thr_spoke1"),
            GraphEdge(source="thr_hub000", target="thr_spoke2"),
        ],
    )


class TestVectorSearcher:
    @pytest.mark.asyncio
    async def test_basic_search(self, tmp_vault, fake_embed):
        _write_note(tmp_vault, "auth.md", "Authentication Guide", "## OAuth\n\nOAuth2 flows.")
        _write_note(tmp_vault, "db.md", "Database Guide", "## Queries\n\nSQL basics.")

        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        await indexer.reindex_vault(tmp_vault / "threads")

        searcher = VectorSearcher(indexer, fake_embed)
        results = await searcher.search("authentication")
        assert len(results) > 0
        # All results should have required fields
        for r in results:
            assert r.note_id
            assert r.score > 0

    @pytest.mark.asyncio
    async def test_type_filter(self, tmp_vault, fake_embed):
        _write_note(tmp_vault, "proj.md", "Project X", "Project details.",
                     note_type="project", note_id="thr_proj00")
        _write_note(tmp_vault, "topic.md", "Topic Y", "Topic details.",
                     note_type="topic", note_id="thr_topic0")

        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        await indexer.reindex_vault(tmp_vault / "threads")

        searcher = VectorSearcher(indexer, fake_embed)
        results = await searcher.search("details", filters={"type": "project"})
        assert all(r.note_type == "project" for r in results)

    @pytest.mark.asyncio
    async def test_tag_filter(self, tmp_vault, fake_embed):
        _write_note(tmp_vault, "tagged.md", "Tagged Note", "Content.",
                     tags=["python", "api"], note_id="thr_tagged")
        _write_note(tmp_vault, "other.md", "Other Note", "Content.",
                     tags=["rust"], note_id="thr_other0")

        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        await indexer.reindex_vault(tmp_vault / "threads")

        searcher = VectorSearcher(indexer, fake_embed)
        results = await searcher.search("content", filters={"tags": ["python"]})
        assert all("python" in r.tags for r in results)

    @pytest.mark.asyncio
    async def test_graph_boost(self, tmp_vault, fake_embed, sample_graph):
        _write_note(tmp_vault, "hub.md", "Hub", "Central note.",
                     note_id="thr_hub000")
        _write_note(tmp_vault, "spoke1.md", "Spoke 1", "Connected note.",
                     note_id="thr_spoke1")
        _write_note(tmp_vault, "spoke2.md", "Spoke 2", "Connected note.",
                     note_id="thr_spoke2")
        _write_note(tmp_vault, "island.md", "Island", "Isolated note.",
                     note_id="thr_island")

        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        await indexer.reindex_vault(tmp_vault / "threads")

        searcher = VectorSearcher(indexer, fake_embed, sample_graph)

        # Without context — all results should have similar scores
        results_no_ctx = await searcher.search("note")

        # With hub as context — spoke1 and spoke2 should be boosted
        results_with_ctx = await searcher.search(
            "note", context_note_ids=["thr_hub000"]
        )

        # Find spoke scores in both result sets
        def _score_for(results, note_id):
            for r in results:
                if r.note_id == note_id:
                    return r.score
            return 0.0

        spoke1_boosted = _score_for(results_with_ctx, "thr_spoke1")
        spoke1_normal = _score_for(results_no_ctx, "thr_spoke1")
        island_boosted = _score_for(results_with_ctx, "thr_island")
        island_normal = _score_for(results_no_ctx, "thr_island")

        # Spoke1 should be boosted, island should not
        if spoke1_normal > 0:
            assert spoke1_boosted > spoke1_normal
        if island_normal > 0:
            assert island_boosted == island_normal

    @pytest.mark.asyncio
    async def test_deduplication_by_note(self, tmp_vault, fake_embed):
        """Multi-chunk notes should only appear once in results."""
        _write_note(
            tmp_vault, "multi.md", "Multi Section",
            "## Part A\n\nSame keyword.\n\n## Part B\n\nSame keyword.",
            note_id="thr_multi0",
        )

        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        await indexer.reindex_vault(tmp_vault / "threads")

        searcher = VectorSearcher(indexer, fake_embed)
        results = await searcher.search("keyword")
        note_ids = [r.note_id for r in results]
        assert len(note_ids) == len(set(note_ids)), "Duplicate note_ids in results"

    @pytest.mark.asyncio
    async def test_empty_index_returns_empty(self, tmp_vault, fake_embed):
        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        searcher = VectorSearcher(indexer, fake_embed)
        results = await searcher.search("anything")
        assert results == []

"""Tests for index/indexer.py — LanceDB vector indexing."""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from core.notes import build_frontmatter
from index.indexer import VectorIndexer


@pytest.fixture
def tmp_vault(tmp_path):
    """Create a minimal vault structure for testing."""
    threads = tmp_path / "threads"
    topics = threads / "topics"
    topics.mkdir(parents=True)
    loom = tmp_path / ".loom"
    loom.mkdir()
    return tmp_path


@pytest.fixture
def fake_embed():
    """Embed provider that returns a fixed-length vector."""
    provider = AsyncMock()
    provider.embed = AsyncMock(return_value=[0.1] * 16)
    return provider


def _write_note(folder: Path, filename: str, title: str, body: str, **meta_overrides) -> Path:
    meta = {
        "id": f"thr_{filename[:6]}",
        "title": title,
        "type": "topic",
        "tags": ["test"],
        "created": "2026-01-01T00:00:00+00:00",
        "modified": "2026-01-01T00:00:00+00:00",
        "author": "user",
        "status": "active",
    }
    meta.update(meta_overrides)
    content = build_frontmatter(meta) + "\n" + body
    path = folder / filename
    path.write_text(content, encoding="utf-8")
    return path


class TestVectorIndexer:
    @pytest.mark.asyncio
    async def test_index_note(self, tmp_vault, fake_embed):
        note_path = _write_note(
            tmp_vault / "threads" / "topics",
            "auth.md",
            "Authentication",
            "## Overview\n\nAuth system design.\n\n## Details\n\nOAuth2 flow.",
        )
        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        count = await indexer.index_note(note_path)
        assert count == 2  # Two ## sections
        assert fake_embed.embed.call_count == 2

    @pytest.mark.asyncio
    async def test_reindex_vault(self, tmp_vault, fake_embed):
        topics = tmp_vault / "threads" / "topics"
        _write_note(topics, "note1.md", "Note One", "Content one.")
        _write_note(topics, "note2.md", "Note Two", "## A\n\nA.\n\n## B\n\nB.")
        _write_note(
            topics,
            "note3.md",
            "Note Three",
            "Simple content.",
            id="thr_note3x",
        )

        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        total = await indexer.reindex_vault(tmp_vault / "threads")
        # note1: 1 chunk, note2: 2 chunks, note3: 1 chunk = 4
        assert total == 4

    @pytest.mark.asyncio
    async def test_remove_note(self, tmp_vault, fake_embed):
        note_path = _write_note(
            tmp_vault / "threads" / "topics",
            "remove.md",
            "To Remove",
            "Content.",
        )
        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        await indexer.index_note(note_path)
        assert indexer.is_ready

        indexer.remove_note("thr_remove")
        # After removing the only note, the table should be empty
        db = indexer.get_db()
        table = db.open_table("chunks")
        assert table.count_rows() == 0

    @pytest.mark.asyncio
    async def test_is_ready(self, tmp_vault, fake_embed):
        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        assert not indexer.is_ready

        note_path = _write_note(
            tmp_vault / "threads" / "topics",
            "ready.md",
            "Ready Note",
            "Content.",
        )
        await indexer.index_note(note_path)
        assert indexer.is_ready

    @pytest.mark.asyncio
    async def test_upsert_replaces_old_chunks(self, tmp_vault, fake_embed):
        note_path = _write_note(
            tmp_vault / "threads" / "topics",
            "upsert.md",
            "Upsert Test",
            "## A\n\nFirst.\n\n## B\n\nSecond.",
        )
        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        await indexer.index_note(note_path)

        db = indexer.get_db()
        table = db.open_table("chunks")
        assert table.count_rows() == 2

        # Rewrite with only one section
        note_path.write_text(
            build_frontmatter(
                {
                    "id": "thr_upsert",
                    "title": "Upsert Test",
                    "type": "topic",
                    "tags": [],
                    "status": "active",
                }
            )
            + "\nOnly one section now.",
            encoding="utf-8",
        )
        await indexer.index_note(note_path)
        # Re-open to get fresh count after delete + add
        table = db.open_table("chunks")
        assert table.count_rows() == 1

    @pytest.mark.asyncio
    async def test_excludes_archive(self, tmp_vault, fake_embed):
        archive = tmp_vault / "threads" / ".archive"
        archive.mkdir(parents=True)
        _write_note(archive, "old.md", "Archived", "Old content.")

        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)
        total = await indexer.reindex_vault(tmp_vault / "threads")
        assert total == 0

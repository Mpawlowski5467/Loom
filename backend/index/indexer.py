"""Vector indexer: embed note chunks and store in LanceDB."""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING

import lancedb

from index.chunker import Chunk, chunk_file

if TYPE_CHECKING:
    from pathlib import Path

    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

TABLE_NAME = "chunks"


def _rows_from_chunks(chunks: list[Chunk], vectors: list[list[float]]) -> list[dict]:
    """Build row dicts ready for LanceDB insertion."""
    return [
        {
            "id": f"{c.note_id}_{c.chunk_index}",
            "note_id": c.note_id,
            "chunk_index": c.chunk_index,
            "heading": c.heading,
            "text": c.embed_text,
            "tags": list(c.tags),
            "note_type": c.note_type,
            "vector": vec,
        }
        for c, vec in zip(chunks, vectors, strict=True)
    ]


class VectorIndexer:
    """Manages the LanceDB vector index for a vault."""

    def __init__(self, loom_dir: Path, embed_provider: BaseProvider) -> None:
        self._db_path = loom_dir / "index.db"
        self._embed = embed_provider
        self._db: lancedb.DBConnection | None = None

    def _get_db(self) -> lancedb.DBConnection:
        """Lazily open (or create) the LanceDB database."""
        if self._db is None:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            self._db = lancedb.connect(str(self._db_path))
        return self._db

    def _table_exists(self) -> bool:
        """Check whether the chunks table exists."""
        return TABLE_NAME in self._get_db().list_tables().tables

    def _get_or_create_table(self, data: list[dict] | None = None) -> lancedb.table.Table:
        """Return the chunks table.

        If the table doesn't exist yet, *data* must be provided so LanceDB
        can infer the schema (including the correct fixed-size vector dimension).
        """
        db = self._get_db()
        if self._table_exists():
            return db.open_table(TABLE_NAME)
        if data:
            return db.create_table(TABLE_NAME, data=data)
        # Can't create without data (need vector dimension)
        raise RuntimeError("Cannot create index table without initial data")

    async def _embed_chunks(self, chunks: list[Chunk], batch_size: int = 32) -> list[list[float]]:
        """Embed all chunks via the configured provider.

        Uses asyncio.gather to parallelize up to batch_size concurrent calls.
        """
        import asyncio

        vectors: list[list[float]] = []
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            batch_vecs = await asyncio.gather(*(self._embed.embed(c.embed_text) for c in batch))
            vectors.extend(batch_vecs)
        return vectors

    async def index_note(self, note_path: Path) -> int:
        """Parse, chunk, embed, and upsert a single note. Returns chunk count."""
        chunks = chunk_file(note_path)
        if not chunks:
            return 0

        note_id = chunks[0].note_id
        vectors = await self._embed_chunks(chunks)
        rows = _rows_from_chunks(chunks, vectors)

        if self._table_exists():
            table = self._get_db().open_table(TABLE_NAME)
            self._delete_by_note_id(table, note_id)
            table.add(rows)
        else:
            # First note indexed — create table from data
            self._get_db().create_table(TABLE_NAME, data=rows)

        logger.info("Indexed %d chunks for note %s", len(rows), note_id)
        return len(rows)

    def remove_note(self, note_id: str) -> None:
        """Delete all chunks for a given note from the index."""
        if not self._table_exists():
            return
        table = self._get_db().open_table(TABLE_NAME)
        self._delete_by_note_id(table, note_id)
        logger.info("Removed chunks for note %s", note_id)

    async def reindex_vault(self, threads_dir: Path) -> int:
        """Full reindex of every note in threads/. Returns total chunk count."""
        if not threads_dir.exists():
            return 0

        md_files = [p for p in threads_dir.rglob("*.md") if ".archive" not in p.parts]

        # Drop old table for a clean reindex
        db = self._get_db()
        if self._table_exists():
            db.drop_table(TABLE_NAME)

        # Collect all rows first, then create table from data
        all_rows: list[dict] = []
        for md_path in md_files:
            chunks = chunk_file(md_path)
            if not chunks:
                continue
            vectors = await self._embed_chunks(chunks)
            all_rows.extend(_rows_from_chunks(chunks, vectors))

        if all_rows:
            db.create_table(TABLE_NAME, data=all_rows)

        logger.info("Reindexed vault: %d chunks from %d files", len(all_rows), len(md_files))
        return len(all_rows)

    @property
    def is_ready(self) -> bool:
        """Check whether the index table exists and has data."""
        try:
            if not self._table_exists():
                return False
            table = self._get_db().open_table(TABLE_NAME)
            return table.count_rows() > 0
        except Exception:  # noqa: BLE001
            return False

    @staticmethod
    def _delete_by_note_id(table: lancedb.table.Table, note_id: str) -> None:
        """Delete all rows matching a note_id."""
        with contextlib.suppress(Exception):
            table.delete(f"note_id = '{note_id}'")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_indexer: VectorIndexer | None = None


def get_indexer() -> VectorIndexer | None:
    """Return the global VectorIndexer, or None if not initialized."""
    return _indexer


def init_indexer(loom_dir: Path, embed_provider: BaseProvider) -> VectorIndexer:
    """Create and cache the global VectorIndexer."""
    global _indexer
    _indexer = VectorIndexer(loom_dir, embed_provider)
    return _indexer

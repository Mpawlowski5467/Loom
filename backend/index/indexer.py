"""Vector indexer: embed note chunks and store in LanceDB."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import TYPE_CHECKING, Any

import lancedb

from index.chunker import Chunk, chunk_file

if TYPE_CHECKING:
    from pathlib import Path

    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

TABLE_NAME = "chunks"

# Note ids are generated as ``thr_<hex>``; constrain the delete predicate to a
# safe character class so a crafted frontmatter id can't inject into the
# LanceDB ``where`` clause and delete other rows.
_NOTE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _rows_from_chunks(chunks: list[Chunk], vectors: list[list[float]]) -> list[dict[str, Any]]:
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

    def get_db(self) -> lancedb.DBConnection:
        """Lazily open (or create) the LanceDB database."""
        if self._db is None:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            self._db = lancedb.connect(str(self._db_path))
        return self._db

    def close(self) -> None:
        """Release the cached LanceDB connection if the driver exposes close."""
        db = self._db
        self._db = None
        close = getattr(db, "close", None)
        if callable(close):
            close()

    def open_table(self) -> lancedb.table.Table:
        """Return the chunks table. Raises if it does not yet exist."""
        return self.get_db().open_table(TABLE_NAME)

    def _table_exists(self) -> bool:
        """Check whether the chunks table exists."""
        return TABLE_NAME in self.get_db().list_tables().tables

    def _get_or_create_table(self, data: list[dict[str, Any]] | None = None) -> lancedb.table.Table:
        """Return the chunks table.

        If the table doesn't exist yet, *data* must be provided so LanceDB
        can infer the schema (including the correct fixed-size vector dimension).
        """
        db = self.get_db()
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
        vectors: list[list[float]] = []
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            batch_vecs = await asyncio.gather(*(self._embed.embed(c.embed_text) for c in batch))
            vectors.extend(batch_vecs)
        return vectors

    def _upsert_rows(self, note_id: str, rows: list[dict[str, Any]]) -> None:
        """Replace a note's chunks in the table (sync — run via ``to_thread``)."""
        if self._table_exists():
            table = self.get_db().open_table(TABLE_NAME)
            self._delete_by_note_id(table, note_id)
            table.add(rows)
        else:
            # First note indexed — create table from data (infers the schema).
            self.get_db().create_table(TABLE_NAME, data=rows)

    async def index_note(self, note_path: Path) -> int:
        """Parse, chunk, embed, and upsert a single note. Returns chunk count."""
        chunks = chunk_file(note_path)
        if not chunks:
            return 0

        note_id = chunks[0].note_id
        vectors = await self._embed_chunks(chunks)
        rows = _rows_from_chunks(chunks, vectors)

        # LanceDB writes are blocking — keep them off the event loop.
        await asyncio.to_thread(self._upsert_rows, note_id, rows)

        logger.info("Indexed %d chunks for note %s", len(rows), note_id)
        return len(rows)

    def remove_note(self, note_id: str) -> None:
        """Delete all chunks for a given note from the index."""
        if not self._table_exists():
            return
        table = self.get_db().open_table(TABLE_NAME)
        self._delete_by_note_id(table, note_id)
        logger.info("Removed chunks for note %s", note_id)

    def _swap_table(self, all_rows: list[dict[str, Any]]) -> None:
        """Atomically-ish replace the table contents (sync — run via ``to_thread``).

        The drop happens only *after* every row is embedded, so the live index
        stays queryable for the whole rebuild instead of being empty for the
        (possibly minutes-long) embed window.
        """
        db = self.get_db()
        if all_rows:
            if self._table_exists():
                db.drop_table(TABLE_NAME)
            db.create_table(TABLE_NAME, data=all_rows)
        elif self._table_exists():
            # Genuinely empty vault — clear stale chunks.
            db.drop_table(TABLE_NAME)

    async def reindex_vault(self, threads_dir: Path) -> int:
        """Full reindex of every note in threads/. Returns total chunk count.

        Embeds everything first, then swaps the table in one step (see
        :meth:`_swap_table`) so search never sees an empty index mid-rebuild.
        """
        if not threads_dir.exists():
            return 0

        md_files = [p for p in threads_dir.rglob("*.md") if ".archive" not in p.parts]

        # Embed every note BEFORE touching the live table.
        all_rows: list[dict[str, Any]] = []
        for md_path in md_files:
            chunks = chunk_file(md_path)
            if not chunks:
                continue
            vectors = await self._embed_chunks(chunks)
            all_rows.extend(_rows_from_chunks(chunks, vectors))

        await asyncio.to_thread(self._swap_table, all_rows)

        logger.info("Reindexed vault: %d chunks from %d files", len(all_rows), len(md_files))
        return len(all_rows)

    async def reconcile_vault(self, threads_dir: Path) -> dict[str, int]:
        """Differentially heal the index against the filesystem.

        Embeds only notes that are *missing* from the vector store and drops
        chunks for notes whose files no longer exist. Unlike
        :meth:`reindex_vault` it never re-embeds unchanged notes, so it is cheap
        enough to run on a periodic timer without burning embedding spend.

        Returns:
            A ``{"added": n, "removed": m}`` count of notes added and orphaned
            note-ids removed.
        """
        if not threads_dir.exists():
            return {"added": 0, "removed": 0}

        from core.notes import parse_note_meta

        file_ids: dict[str, Path] = {}
        for md_path in threads_dir.rglob("*.md"):
            if ".archive" in md_path.parts:
                continue
            try:
                note_id = parse_note_meta(md_path).id
            except (OSError, ValueError):
                continue
            if note_id:
                file_ids[note_id] = md_path

        indexed = await asyncio.to_thread(self.indexed_note_ids)

        added = 0
        for note_id in file_ids.keys() - indexed:
            try:
                await self.index_note(file_ids[note_id])
                added += 1
            except Exception:  # noqa: BLE001 - one bad note shouldn't abort reconcile
                logger.warning("Reconcile: index failed for %s", file_ids[note_id], exc_info=True)

        removed = 0
        for note_id in indexed - file_ids.keys():
            try:
                await asyncio.to_thread(self.remove_note, note_id)
                removed += 1
            except Exception:  # noqa: BLE001
                logger.warning("Reconcile: remove failed for %s", note_id, exc_info=True)

        if added or removed:
            logger.info("Reconciled index: +%d note(s), -%d orphaned", added, removed)
        return {"added": added, "removed": removed}

    @property
    def is_ready(self) -> bool:
        """Check whether the index table exists and has data."""
        try:
            if not self._table_exists():
                return False
            table = self.get_db().open_table(TABLE_NAME)
            return bool(table.count_rows() > 0)
        except Exception:  # noqa: BLE001
            return False

    def indexed_note_ids(self) -> set[str]:
        """Return the distinct note ids present in the vector store.

        Returns an empty set when the table doesn't exist or can't be read —
        same defensive posture as :attr:`is_ready`, so a cold index reconciles
        to "everything unindexed" rather than raising.
        """
        try:
            if not self._table_exists():
                return set()
            table = self.get_db().open_table(TABLE_NAME)
            # Project to just note_id (avoids materializing vectors) and read
            # via Arrow — robust across lancedb versions for a full scan.
            arrow = table.to_arrow().select(["note_id"])
            return {nid for nid in arrow.column("note_id").to_pylist() if nid}
        except Exception:  # noqa: BLE001
            return set()

    @staticmethod
    def _delete_by_note_id(table: lancedb.table.Table, note_id: str) -> None:
        """Delete all rows matching a note_id.

        The note_id is validated against a safe character class before being
        interpolated into the LanceDB predicate, so a crafted frontmatter id
        can't inject into the ``where`` clause. Delete failures are logged
        rather than silently swallowed (a swallowed failure leaves stale chunks).
        """
        if not _NOTE_ID_RE.match(note_id):
            logger.warning("Refusing to delete chunks for unsafe note_id: %r", note_id)
            return
        try:
            table.delete(f"note_id = '{note_id}'")
        except Exception:  # noqa: BLE001 - lancedb raises a variety of driver errors
            logger.warning("Failed to delete chunks for note %s", note_id, exc_info=True)


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


def reset_indexer() -> None:
    """Close and clear the global VectorIndexer."""
    global _indexer
    if _indexer is not None:
        _indexer.close()
    _indexer = None


def unindexed_note_ids(threads_dir: Path | None = None) -> list[str]:
    """Return note ids present in NoteIndex but absent from the vector store.

    Reconciles the in-memory metadata index against LanceDB to surface "index
    drift" — notes that were added to NoteIndex (and so appear in the file tree
    and graph) but whose embeddings never landed, leaving them invisible to
    search. Returns ``[]`` when the indexer is uninitialized or the vector store
    can't be read, so a cold start never reports false drift.

    Args:
        threads_dir: Unused; accepted for call-site symmetry with other
            reconciliation helpers and possible future filtering.
    """
    indexer = get_indexer()
    if indexer is None:
        return []
    from core.note_index import get_note_index

    indexed = indexer.indexed_note_ids()
    if not indexed:
        # Cold/empty index: treat as "not yet built" rather than total drift,
        # so we don't spuriously flag every note before the first index pass.
        return []
    meta_ids = {m.id for m in get_note_index().all_metas() if m.id}
    return sorted(meta_ids - indexed)


def unindexed_note_paths() -> list[Path]:
    """Resolve :func:`unindexed_note_ids` to file paths via NoteIndex.

    Used by startup reconciliation to re-queue drifted notes for indexing.
    """
    from core.note_index import get_note_index

    note_index = get_note_index()
    paths: list[Path] = []
    for note_id in unindexed_note_ids():
        path = note_index.get_path_by_id(note_id)
        if path is not None:
            paths.append(path)
    return paths

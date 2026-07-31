"""Tests: archived notes must never enter the NoteIndex or the vector index.

``NoteIndex.build``/``move_file`` and ``reindex_vault``/``reconcile_vault``
already filter ``.archive``; these tests pin the same invariant for the two
remaining entry points — the watcher's create/modify events (watchdog can
report a move into ``.archive`` as delete+create, e.g. macOS FSEvents) and
the single-file vector entry point ``index_note`` — plus eviction when a
live, indexed note is moved into the archive.
"""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from watchdog.events import (
    FileCreatedEvent,
    FileDeletedEvent,
    FileModifiedEvent,
    FileMovedEvent,
)

from core.note_index import get_note_index
from core.watcher import _VaultEventHandler
from index.indexer import VectorIndexer, init_indexer, reset_indexer


@pytest.fixture
def tmp_vault(tmp_path: Path) -> Path:
    """Create a minimal vault structure for testing."""
    (tmp_path / "threads").mkdir(parents=True)
    (tmp_path / ".loom").mkdir()
    return tmp_path


@pytest.fixture
def fake_embed() -> AsyncMock:
    """Embed provider that returns a fixed-length vector."""
    provider = AsyncMock()
    provider.embed = AsyncMock(return_value=[0.1] * 16)
    return provider


def _make_handler(vault_root: Path) -> _VaultEventHandler:
    """Create a handler on the real NoteIndex singleton (reset per test)."""
    return _VaultEventHandler(vault_root / "threads", vault_root / ".loom", loop=None)


def _write_note(path: Path, note_id: str, title: str) -> Path:
    """Write a minimal markdown note to the given path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\nid: {note_id}\ntitle: {title}\ntype: topic\ntags: []\n"
        f"created: 2026-03-15T00:00:00+00:00\nmodified: 2026-03-15T00:00:00+00:00\n"
        f"author: user\nstatus: active\nhistory: []\n---\n\n## Content\n\nSome text.\n"
    )
    return path


# ---------------------------------------------------------------------------
# Watcher create/modify events on .archive paths
# ---------------------------------------------------------------------------


class TestArchiveEventFiltering:
    def test_created_on_archive_path_indexes_nothing(self, tmp_vault: Path) -> None:
        handler = _make_handler(tmp_vault)
        archived = _write_note(
            tmp_vault / "threads" / ".archive" / "old-note.md", "thr_arch01", "Old Note"
        )
        vector_calls: list[Path] = []
        handler._vector_index_file = vector_calls.append  # type: ignore[method-assign]

        handler.on_created(FileCreatedEvent(str(archived)))

        index = get_note_index()
        assert index.get_by_path(archived) is None
        assert index.get_by_id("thr_arch01") is None
        assert vector_calls == []

    def test_modified_on_archive_path_indexes_nothing(self, tmp_vault: Path) -> None:
        handler = _make_handler(tmp_vault)
        archived = _write_note(
            tmp_vault / "threads" / ".archive" / "old-note.md", "thr_arch01", "Old Note"
        )
        vector_calls: list[Path] = []
        handler._vector_index_file = vector_calls.append  # type: ignore[method-assign]

        handler.on_modified(FileModifiedEvent(str(archived)))

        index = get_note_index()
        assert index.get_by_path(archived) is None
        assert index.get_by_id("thr_arch01") is None
        assert vector_calls == []

    def test_created_and_modified_on_live_paths_still_index(self, tmp_vault: Path) -> None:
        handler = _make_handler(tmp_vault)
        live = _write_note(
            tmp_vault / "threads" / "topics" / "live-note.md", "thr_live01", "Live Note"
        )
        vector_calls: list[Path] = []
        handler._vector_index_file = vector_calls.append  # type: ignore[method-assign]

        handler.on_created(FileCreatedEvent(str(live)))
        handler.on_modified(FileModifiedEvent(str(live)))

        index = get_note_index()
        assert index.get_by_path(live) is not None
        assert index.get_by_id("thr_live01") is not None
        assert vector_calls == [live, live]


# ---------------------------------------------------------------------------
# Vector index single-file entry point
# ---------------------------------------------------------------------------


class TestIndexNoteArchiveGuard:
    @pytest.mark.asyncio
    async def test_index_note_skips_archived_path(
        self, tmp_vault: Path, fake_embed: AsyncMock
    ) -> None:
        archived = _write_note(tmp_vault / "threads" / ".archive" / "old.md", "thr_arch01", "Old")
        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)

        count = await indexer.index_note(archived)

        assert count == 0
        assert indexer.indexed_note_ids() == set()
        fake_embed.embed.assert_not_called()

    @pytest.mark.asyncio
    async def test_index_note_still_indexes_live_path(
        self, tmp_vault: Path, fake_embed: AsyncMock
    ) -> None:
        live = _write_note(tmp_vault / "threads" / "topics" / "live.md", "thr_live01", "Live")
        indexer = VectorIndexer(tmp_vault / ".loom", fake_embed)

        count = await indexer.index_note(live)

        assert count > 0
        assert "thr_live01" in indexer.indexed_note_ids()


# ---------------------------------------------------------------------------
# Move into .archive evicts the live entries
# ---------------------------------------------------------------------------


class TestMoveIntoArchiveEviction:
    @pytest.mark.asyncio
    async def test_move_event_into_archive_evicts_both_indexes(
        self, tmp_vault: Path, fake_embed: AsyncMock
    ) -> None:
        handler = _make_handler(tmp_vault)
        indexer = init_indexer(tmp_vault / ".loom", fake_embed)
        try:
            live = _write_note(
                tmp_vault / "threads" / "topics" / "doomed.md", "thr_doom01", "Doomed"
            )
            get_note_index().refresh_file(live)
            await indexer.index_note(live)
            assert "thr_doom01" in indexer.indexed_note_ids()

            dest = tmp_vault / "threads" / ".archive" / "doomed.md"
            dest.parent.mkdir(parents=True, exist_ok=True)
            live.rename(dest)
            handler.on_moved(FileMovedEvent(str(live), str(dest)))

            index = get_note_index()
            assert index.get_by_path(live) is None
            assert index.get_by_path(dest) is None
            assert index.get_by_id("thr_doom01") is None
            assert "thr_doom01" not in indexer.indexed_note_ids()
        finally:
            reset_indexer()

    @pytest.mark.asyncio
    async def test_delete_plus_create_into_archive_evicts_both_indexes(
        self, tmp_vault: Path, fake_embed: AsyncMock
    ) -> None:
        """macOS decomposition: a move into .archive surfaces as
        FileDeletedEvent(src) + FileCreatedEvent(dest)."""
        handler = _make_handler(tmp_vault)
        indexer = init_indexer(tmp_vault / ".loom", fake_embed)
        try:
            live = _write_note(
                tmp_vault / "threads" / "topics" / "doomed.md", "thr_doom02", "Doomed"
            )
            get_note_index().refresh_file(live)
            await indexer.index_note(live)
            assert "thr_doom02" in indexer.indexed_note_ids()

            dest = tmp_vault / "threads" / ".archive" / "doomed.md"
            dest.parent.mkdir(parents=True, exist_ok=True)
            live.rename(dest)
            handler.on_deleted(FileDeletedEvent(str(live)))
            handler.on_created(FileCreatedEvent(str(dest)))

            index = get_note_index()
            assert index.get_by_path(live) is None
            assert index.get_by_path(dest) is None
            assert index.get_by_id("thr_doom02") is None
            assert "thr_doom02" not in indexer.indexed_note_ids()
        finally:
            reset_indexer()

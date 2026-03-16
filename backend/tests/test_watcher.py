"""Tests for the file watcher in core/watcher.py."""

import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

from watchdog.events import (
    DirModifiedEvent,
    FileCreatedEvent,
    FileDeletedEvent,
    FileModifiedEvent,
    FileMovedEvent,
)

from core.note_index import IndexEntry, NoteIndex
from core.watcher import _VaultEventHandler


def _make_handler(
    tmp_path: Path,
    note_index: NoteIndex | None = None,
) -> _VaultEventHandler:
    """Create a _VaultEventHandler backed by tmp_path with a mock note_index."""
    threads_dir = tmp_path / "threads"
    threads_dir.mkdir(parents=True, exist_ok=True)
    loom_dir = tmp_path / ".loom"
    loom_dir.mkdir(parents=True, exist_ok=True)

    handler = _VaultEventHandler(threads_dir, loom_dir, loop=None)

    # Replace the handler's index with our controllable mock/instance
    if note_index is not None:
        handler._index = note_index

    return handler


def _write_note(path: Path, note_id: str = "thr_test01", title: str = "Test") -> None:
    """Write a minimal markdown note to the given path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\nid: {note_id}\ntitle: {title}\ntype: topic\ntags: []\n"
        f"created: 2026-03-15T00:00:00+00:00\nmodified: 2026-03-15T00:00:00+00:00\n"
        f"author: user\nstatus: active\nhistory: []\n---\n\n## Content\n\nSome text.\n"
    )


# ---------------------------------------------------------------------------
# File creation
# ---------------------------------------------------------------------------


class TestOnCreated:
    def test_md_file_triggers_refresh(self, tmp_path: Path) -> None:
        """on_created for a .md file calls note_index.refresh_file."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        md_path = tmp_path / "threads" / "topics" / "new-note.md"
        _write_note(md_path)

        event = FileCreatedEvent(str(md_path))

        with patch("index.indexer.get_indexer", return_value=None):
            handler.on_created(event)

        mock_index.refresh_file.assert_called_once_with(md_path)

    def test_non_md_file_ignored(self, tmp_path: Path) -> None:
        """on_created for a non-.md file does not trigger refresh."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        txt_path = tmp_path / "threads" / "notes.txt"
        txt_path.parent.mkdir(parents=True, exist_ok=True)
        txt_path.write_text("not markdown")

        event = FileCreatedEvent(str(txt_path))
        handler.on_created(event)

        mock_index.refresh_file.assert_not_called()


# ---------------------------------------------------------------------------
# File modification
# ---------------------------------------------------------------------------


class TestOnModified:
    def test_md_file_triggers_refresh(self, tmp_path: Path) -> None:
        """on_modified for a .md file calls note_index.refresh_file."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        md_path = tmp_path / "threads" / "topics" / "existing.md"
        _write_note(md_path)

        event = FileModifiedEvent(str(md_path))

        with patch("index.indexer.get_indexer", return_value=None):
            handler.on_modified(event)

        mock_index.refresh_file.assert_called_once_with(md_path)

    def test_non_md_file_ignored(self, tmp_path: Path) -> None:
        """on_modified for a non-.md file does not trigger refresh."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        event = FileModifiedEvent(str(tmp_path / "threads" / "data.json"))
        handler.on_modified(event)

        mock_index.refresh_file.assert_not_called()


# ---------------------------------------------------------------------------
# File deletion
# ---------------------------------------------------------------------------


class TestOnDeleted:
    def test_md_file_triggers_remove(self, tmp_path: Path) -> None:
        """on_deleted for a .md file calls note_index.remove_file."""
        mock_index = MagicMock(spec=NoteIndex)
        mock_index.get_by_path.return_value = None
        handler = _make_handler(tmp_path, note_index=mock_index)

        md_path = tmp_path / "threads" / "topics" / "deleted.md"

        event = FileDeletedEvent(str(md_path))

        with patch("index.indexer.get_indexer", return_value=None):
            handler.on_deleted(event)

        mock_index.remove_file.assert_called_once_with(md_path)

    def test_deletion_removes_from_vector_index(self, tmp_path: Path) -> None:
        """on_deleted with a known note_id calls vector_remove_note."""
        mock_index = MagicMock(spec=NoteIndex)
        mock_entry = MagicMock(spec=IndexEntry)
        mock_entry.id = "thr_del001"
        mock_index.get_by_path.return_value = mock_entry
        handler = _make_handler(tmp_path, note_index=mock_index)

        md_path = tmp_path / "threads" / "topics" / "to-delete.md"
        event = FileDeletedEvent(str(md_path))

        mock_vector_indexer = MagicMock()

        with patch("index.indexer.get_indexer", return_value=mock_vector_indexer):
            handler.on_deleted(event)

        mock_vector_indexer.remove_note.assert_called_once_with("thr_del001")

    def test_non_md_file_ignored(self, tmp_path: Path) -> None:
        """on_deleted for a non-.md file does not call remove_file."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        event = FileDeletedEvent(str(tmp_path / "threads" / "data.json"))
        handler.on_deleted(event)

        mock_index.remove_file.assert_not_called()


# ---------------------------------------------------------------------------
# Debounce: _schedule_rebuild
# ---------------------------------------------------------------------------


class TestScheduleRebuild:
    def test_debounce_cancels_previous_timer(self, tmp_path: Path) -> None:
        """Calling _schedule_rebuild twice cancels the first timer."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        # First call — timer is set
        handler._schedule_rebuild()
        timer1 = handler._rebuild_timer
        assert timer1 is not None
        assert isinstance(timer1, threading.Timer)

        # Second call — first timer should be cancelled
        handler._schedule_rebuild()
        timer2 = handler._rebuild_timer
        assert timer2 is not None
        assert timer2 is not timer1

        # Clean up timers
        timer1.cancel()
        timer2.cancel()

    def test_rebuild_timer_is_daemon(self, tmp_path: Path) -> None:
        """Rebuild timer should be a daemon thread so it doesn't block shutdown."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        handler._schedule_rebuild()
        timer = handler._rebuild_timer
        assert timer is not None
        assert timer.daemon is True

        timer.cancel()


# ---------------------------------------------------------------------------
# _rebuild triggers graph build
# ---------------------------------------------------------------------------


class TestRebuild:
    def test_rebuild_calls_build_graph_and_save(self, tmp_path: Path) -> None:
        """_rebuild builds the graph and saves it to .loom/."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        mock_graph = MagicMock()

        with (
            patch("core.watcher.build_graph", return_value=mock_graph) as mock_build,
            patch("core.watcher.save_graph") as mock_save,
            patch("index.searcher.get_searcher", return_value=None),
        ):
            handler._rebuild()

        mock_build.assert_called_once_with(handler._threads_dir)
        mock_save.assert_called_once_with(mock_graph, handler._loom_dir)


# ---------------------------------------------------------------------------
# on_moved
# ---------------------------------------------------------------------------


class TestOnMoved:
    def test_md_move_updates_index(self, tmp_path: Path) -> None:
        """on_moved for .md files calls move_file on note_index."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        src = tmp_path / "threads" / "captures" / "note.md"
        dest = tmp_path / "threads" / "topics" / "note.md"
        _write_note(dest)

        event = FileMovedEvent(str(src), str(dest))

        with patch("index.indexer.get_indexer", return_value=None):
            handler.on_moved(event)

        mock_index.move_file.assert_called_once_with(src, dest)

    def test_non_md_move_ignored(self, tmp_path: Path) -> None:
        """on_moved for non-.md files does nothing."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        event = FileMovedEvent(
            str(tmp_path / "data.json"),
            str(tmp_path / "data-backup.json"),
        )
        handler.on_moved(event)

        mock_index.move_file.assert_not_called()


# ---------------------------------------------------------------------------
# _is_md filter
# ---------------------------------------------------------------------------


class TestIsMd:
    def test_recognizes_md_files(self, tmp_path: Path) -> None:
        """_is_md returns True for .md files."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        event = FileCreatedEvent(str(tmp_path / "note.md"))
        assert handler._is_md(event) is True

    def test_rejects_non_md_files(self, tmp_path: Path) -> None:
        """_is_md returns False for non-.md files."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        event = FileCreatedEvent(str(tmp_path / "note.txt"))
        assert handler._is_md(event) is False

    def test_rejects_directory_events(self, tmp_path: Path) -> None:
        """_is_md returns False for directory events."""
        mock_index = MagicMock(spec=NoteIndex)
        handler = _make_handler(tmp_path, note_index=mock_index)

        event = DirModifiedEvent(str(tmp_path / "topics"))
        assert handler._is_md(event) is False

"""File watcher: rebuild graph.json, update note index, and vector-index on vault changes."""

import asyncio
import logging
import threading
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from core.graph import build_graph, save_graph
from core.note_index import get_note_index
from core.notes import parse_note_meta

logger = logging.getLogger(__name__)

_DEBOUNCE_SECONDS = 0.5
_BATCH_REINDEX_SECONDS = 30 * 60  # 30 minutes


class _VaultEventHandler(FileSystemEventHandler):
    """Updates note index immediately and debounces graph rebuilds.

    Also triggers vector re-indexing for changed notes.
    """

    def __init__(self, threads_dir: Path, loom_dir: Path) -> None:
        self._threads_dir = threads_dir
        self._loom_dir = loom_dir
        self._rebuild_timer: threading.Timer | None = None
        self._timer_lock = threading.Lock()
        self._index = get_note_index()

    def _is_md(self, event: FileSystemEvent) -> bool:
        return str(event.src_path).endswith(".md")

    def on_created(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._index.refresh_file(Path(event.src_path))
            self._vector_index_file(Path(event.src_path))
            self._schedule_rebuild()

    def on_modified(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._index.refresh_file(Path(event.src_path))
            self._vector_index_file(Path(event.src_path))
            self._schedule_rebuild()

    def on_deleted(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            path = Path(event.src_path)
            # Grab note_id before removing from in-memory index
            entry = self._index.get_by_path(path)
            note_id = entry.id if entry else None
            self._index.remove_file(path)
            if note_id:
                self._vector_remove_note(note_id)
            self._schedule_rebuild()

    def on_moved(self, event: FileSystemEvent) -> None:
        src = str(event.src_path)
        dest = str(event.dest_path)
        if src.endswith(".md") or dest.endswith(".md"):
            self._index.move_file(Path(src), Path(dest))
            if dest.endswith(".md") and ".archive" not in Path(dest).parts:
                self._vector_index_file(Path(dest))
            elif src.endswith(".md"):
                # File moved away (e.g. archived) — try to extract note_id
                try:
                    meta = parse_note_meta(Path(dest))
                    if meta.id:
                        self._vector_remove_note(meta.id)
                except Exception:  # noqa: BLE001
                    pass
            self._schedule_rebuild()

    def _vector_index_file(self, path: Path) -> None:
        """Re-index a single file in the vector store (async via new event loop)."""
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is None:
            return
        try:
            asyncio.run(indexer.index_note(path))
        except Exception:  # noqa: BLE001
            logger.debug("Vector index update failed for %s", path, exc_info=True)

    def _vector_remove_note(self, note_id: str) -> None:
        """Remove a note from the vector store."""
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is None:
            return
        try:
            indexer.remove_note(note_id)
        except Exception:  # noqa: BLE001
            logger.debug("Vector remove failed for %s", note_id, exc_info=True)

    def _schedule_rebuild(self) -> None:
        """Debounce graph rebuilds — wait for changes to settle."""
        with self._timer_lock:
            if self._rebuild_timer is not None:
                self._rebuild_timer.cancel()
            self._rebuild_timer = threading.Timer(
                _DEBOUNCE_SECONDS,
                self._rebuild,
            )
            self._rebuild_timer.daemon = True
            self._rebuild_timer.start()

    def _rebuild(self) -> None:
        logger.info("Vault change detected — rebuilding graph.json")
        graph = build_graph(self._threads_dir)
        save_graph(graph, self._loom_dir)

        # Update the searcher's graph cache
        from index.searcher import get_searcher

        searcher = get_searcher()
        if searcher is not None:
            searcher.set_graph(graph)


_observer: Observer | None = None
_batch_timer: threading.Timer | None = None


def _schedule_batch_reindex(threads_dir: Path, loom_dir: Path) -> None:
    """Schedule periodic full vector reindex."""
    global _batch_timer

    def _do_batch() -> None:
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is not None:
            logger.info("Running scheduled batch reindex")
            try:
                asyncio.run(indexer.reindex_vault(threads_dir))
            except Exception:  # noqa: BLE001
                logger.warning("Batch reindex failed", exc_info=True)
        # Reschedule
        _schedule_batch_reindex(threads_dir, loom_dir)

    _batch_timer = threading.Timer(_BATCH_REINDEX_SECONDS, _do_batch)
    _batch_timer.daemon = True
    _batch_timer.start()


def start_watcher(vault_root: Path) -> Observer:
    """Start watching the vault's threads/ directory for .md changes."""
    global _observer
    if _observer is not None:
        _observer.stop()

    threads_dir = vault_root / "threads"
    loom_dir = vault_root / ".loom"

    # Build note index on startup
    index = get_note_index()
    index.build(threads_dir)

    handler = _VaultEventHandler(threads_dir, loom_dir)

    _observer = Observer()
    _observer.schedule(handler, str(threads_dir), recursive=True)
    _observer.daemon = True
    _observer.start()

    # Start periodic batch reindex
    _schedule_batch_reindex(threads_dir, loom_dir)

    logger.info("File watcher started for %s", threads_dir)
    return _observer


def stop_watcher() -> None:
    """Stop the active file watcher and batch reindex timer."""
    global _observer, _batch_timer
    if _observer is not None:
        _observer.stop()
        _observer = None
    if _batch_timer is not None:
        _batch_timer.cancel()
        _batch_timer = None

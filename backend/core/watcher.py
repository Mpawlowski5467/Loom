"""File watcher: rebuild graph.json, update note index, and vector-index on vault changes."""

import asyncio
import contextlib
import hashlib
import logging
import queue
import threading
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.api import BaseObserver

from core.graph import build_graph, save_graph
from core.note_index import get_note_index
from core.notes import parse_note_meta

logger = logging.getLogger(__name__)

_DEBOUNCE_SECONDS = 0.5
_BATCH_REINDEX_SECONDS = 30 * 60  # 30 minutes
_INDEX_TIMEOUT_SECONDS = 30
_WORKER_POLL_SECONDS = 1.0


class _VaultEventHandler(FileSystemEventHandler):
    """Updates note index immediately and debounces graph rebuilds.

    Vector re-indexing is offloaded to a background worker thread so the
    watchdog dispatch thread is never blocked on embedding API calls.
    A content-hash cache skips re-embedding files whose bytes haven't
    changed (e.g. agents that rewrite frontmatter timestamps).
    """

    def __init__(
        self,
        threads_dir: Path,
        loom_dir: Path,
        loop: asyncio.AbstractEventLoop | None = None,
    ) -> None:
        self._threads_dir = threads_dir
        self._loom_dir = loom_dir
        self._rebuild_timer: threading.Timer | None = None
        self._timer_lock = threading.Lock()
        self._index = get_note_index()
        self._loop = loop

        # Dedup cache: file path -> last-indexed sha256
        self._content_hashes: dict[Path, str] = {}
        self._hash_lock = threading.Lock()

        # Background worker for indexer calls
        self._task_queue: queue.Queue[Path] = queue.Queue()
        self._stop_event = threading.Event()
        self._worker = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker.start()

    def _is_md(self, event: FileSystemEvent) -> bool:
        return str(event.src_path).endswith(".md")

    def on_created(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._index.refresh_file(Path(str(event.src_path)))
            self._vector_index_file(Path(str(event.src_path)))
            self._schedule_rebuild()

    def on_modified(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._index.refresh_file(Path(str(event.src_path)))
            self._vector_index_file(Path(str(event.src_path)))
            self._schedule_rebuild()

    def on_deleted(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            path = Path(str(event.src_path))
            entry = self._index.get_by_path(path)
            note_id = entry.id if entry else None
            self._index.remove_file(path)
            self._forget_hash(path)
            if note_id:
                self._vector_remove_note(note_id)
            self._schedule_rebuild()

    def on_moved(self, event: FileSystemEvent) -> None:
        src = str(event.src_path)
        dest = str(event.dest_path or "")
        if src.endswith(".md") or dest.endswith(".md"):
            self._index.move_file(Path(src), Path(dest))
            self._forget_hash(Path(src))
            if dest.endswith(".md") and ".archive" not in Path(dest).parts:
                self._vector_index_file(Path(dest))
            elif src.endswith(".md"):
                try:
                    meta = parse_note_meta(Path(dest))
                except (OSError, ValueError):
                    meta = None
                if meta is not None and meta.id:
                    self._vector_remove_note(meta.id)
            self._schedule_rebuild()

    # -- Hash dedup ---------------------------------------------------------

    def _forget_hash(self, path: Path) -> None:
        with self._hash_lock:
            self._content_hashes.pop(path, None)

    def _content_changed(self, path: Path) -> bool:
        """Return True if ``path``'s content has changed since the last index.

        Updates the cache as a side effect when the file is readable.
        """
        try:
            new_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            return False
        with self._hash_lock:
            if self._content_hashes.get(path) == new_hash:
                return False
            self._content_hashes[path] = new_hash
        return True

    # -- Worker / async dispatch -------------------------------------------

    def _worker_loop(self) -> None:
        """Drain the task queue, calling the indexer outside the watcher thread."""
        while not self._stop_event.is_set():
            try:
                path = self._task_queue.get(timeout=_WORKER_POLL_SECONDS)
            except queue.Empty:
                continue
            try:
                self._do_vector_index(path)
            finally:
                self._task_queue.task_done()

    def _run_async(self, coro: Coroutine[Any, Any, Any]) -> None:
        """Run an async coroutine on the main loop, with a bounded wait."""
        if self._loop is not None and not self._loop.is_closed():
            future = asyncio.run_coroutine_threadsafe(coro, self._loop)
            try:
                future.result(timeout=_INDEX_TIMEOUT_SECONDS)
            except Exception:
                logger.warning("Async operation failed", exc_info=True)
        else:
            logger.warning("Event loop unavailable — skipping async operation")

    def _do_vector_index(self, path: Path) -> None:
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is None:
            return
        try:
            self._run_async(indexer.index_note(path))
        except Exception:
            logger.warning("Vector index update failed for %s", path, exc_info=True)

    def _vector_index_file(self, path: Path) -> None:
        """Queue a re-index of ``path`` if its content actually changed."""
        if not self._content_changed(path):
            logger.debug("Skipping reindex of unchanged file: %s", path)
            return
        self._task_queue.put(path)

    def _vector_remove_note(self, note_id: str) -> None:
        """Remove a note from the vector store synchronously (no API calls)."""
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is None:
            return
        try:
            indexer.remove_note(note_id)
        except Exception:
            logger.warning("Vector remove failed for %s", note_id, exc_info=True)

    # -- Lifecycle ----------------------------------------------------------

    def stop(self) -> None:
        """Signal the worker thread to exit. Best-effort."""
        self._stop_event.set()
        with contextlib.suppress(Exception):
            self._worker.join(timeout=2.0)

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


_observer: BaseObserver | None = None
_handler: _VaultEventHandler | None = None
_batch_timer: threading.Timer | None = None


def _schedule_batch_reindex(
    threads_dir: Path,
    loom_dir: Path,
    loop: asyncio.AbstractEventLoop | None = None,
) -> None:
    """Schedule periodic full vector reindex."""
    global _batch_timer

    def _do_batch() -> None:
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is not None:
            logger.info("Running scheduled batch reindex")
            try:
                if loop is not None and not loop.is_closed():
                    future = asyncio.run_coroutine_threadsafe(
                        indexer.reindex_vault(threads_dir), loop
                    )
                    future.result(timeout=300)
                else:
                    logger.warning("Event loop unavailable — skipping batch reindex")
            except Exception:
                logger.warning("Batch reindex failed", exc_info=True)
        # Reschedule
        _schedule_batch_reindex(threads_dir, loom_dir, loop)

    _batch_timer = threading.Timer(_BATCH_REINDEX_SECONDS, _do_batch)
    _batch_timer.daemon = True
    _batch_timer.start()


def start_watcher(
    vault_root: Path,
    loop: asyncio.AbstractEventLoop | None = None,
) -> BaseObserver:
    """Start watching the vault's threads/ directory for .md changes.

    Args:
        vault_root: Root directory of the vault.
        loop: The main asyncio event loop, used for thread-safe async calls.
    """
    global _observer, _handler
    if _observer is not None:
        _observer.stop()
    if _handler is not None:
        _handler.stop()

    threads_dir = vault_root / "threads"
    loom_dir = vault_root / ".loom"

    # Build note index on startup
    index = get_note_index()
    index.build(threads_dir)

    _handler = _VaultEventHandler(threads_dir, loom_dir, loop=loop)

    _observer = Observer()
    _observer.schedule(_handler, str(threads_dir), recursive=True)
    _observer.daemon = True
    _observer.start()

    # Start periodic batch reindex
    _schedule_batch_reindex(threads_dir, loom_dir, loop)

    logger.info("File watcher started for %s", threads_dir)
    return _observer


def stop_watcher() -> None:
    """Stop the active file watcher, worker thread, and batch reindex timer."""
    global _observer, _handler, _batch_timer
    if _observer is not None:
        _observer.stop()
        _observer = None
    if _handler is not None:
        _handler.stop()
        _handler = None
    if _batch_timer is not None:
        _batch_timer.cancel()
        _batch_timer = None

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
_RECONCILE_SECONDS = 30 * 60  # 30 minutes
_INDEX_TIMEOUT_SECONDS = 30
_RECONCILE_TIMEOUT_SECONDS = 300
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

        # Paths whose vector index failed and are pending a retry. A note can
        # land in NoteIndex but not LanceDB (embedding blip) and become
        # invisible to search; tracking the path here lets startup reconciliation
        # re-queue it and surfaces a count to the health endpoint.
        self._failed_paths: set[Path] = set()
        self._failed_lock = threading.Lock()

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

    def _run_async(self, coro: Coroutine[Any, Any, Any]) -> bool:
        """Run an async coroutine on the main loop, with a bounded wait.

        Returns ``True`` if it completed cleanly, ``False`` if the loop was
        unavailable or the coroutine raised/timed out. The boolean is what lets
        ``_do_vector_index`` track real failures — previously this swallowed the
        exception, so the failure-marking branch below was dead code and a
        failed retry was wrongly cleared from ``_failed_paths``.
        """
        if self._loop is None or self._loop.is_closed():
            logger.warning("Event loop unavailable — skipping async operation")
            return False
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        try:
            future.result(timeout=_INDEX_TIMEOUT_SECONDS)
        except Exception:
            logger.warning("Async operation failed", exc_info=True)
            return False
        return True

    def _do_vector_index(self, path: Path) -> None:
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is None:
            return
        ok = self._run_async(indexer.index_note(path))
        with self._failed_lock:
            if ok:
                # Indexed cleanly — clear any prior failure marker for this path.
                self._failed_paths.discard(path)
            else:
                self._failed_paths.add(path)

    # -- Index-drift tracking ----------------------------------------------

    def failed_count(self) -> int:
        """Number of paths whose vector index currently failed (drift)."""
        with self._failed_lock:
            return len(self._failed_paths)

    def queue_retry(self, paths: list[Path]) -> None:
        """Mark *paths* as failed and queue them for a re-index attempt.

        Used by startup reconciliation to heal drift detected between
        NoteIndex and the vector store. Each path is re-queued onto the same
        worker that handles live edits, so the retry happens off the main
        thread.
        """
        with self._failed_lock:
            self._failed_paths.update(paths)
        for path in paths:
            self._task_queue.put(path)

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

        # Push a live signal to any open UI so it re-fetches instead of waiting
        # for a manual reload. Hops onto the event loop from this timer thread.
        from core.events import VAULT_CHANGED, get_event_hub

        get_event_hub().publish_threadsafe(self._loop, VAULT_CHANGED)


_observer: BaseObserver | None = None
_handler: _VaultEventHandler | None = None
_reconcile_timer: threading.Timer | None = None
# Guards the reconcile timer chain against surviving a stop/restart. Each
# chain captures ``_reconcile_generation`` when scheduled; ``stop_watcher``
# (and ``start_watcher``) bump it, so a timer that fires late — or a reconcile
# that was already executing when the cancel landed — sees itself as stale
# and neither touches the index nor reschedules.
_reconcile_lock = threading.Lock()
_reconcile_generation = 0


def failed_index_paths() -> int:
    """Return the count of notes whose vector index failed (index drift).

    Reaches the active handler the same way ``health.check_watcher`` reaches
    ``_observer``. Returns 0 when no watcher is running.
    """
    return _handler.failed_count() if _handler is not None else 0


def seed_retryable(paths: list[Path]) -> None:
    """Queue *paths* for a vector re-index via the active handler.

    No-op when no watcher is running. Used by startup reconciliation to heal
    notes present in NoteIndex but missing from the vector store.
    """
    if _handler is not None and paths:
        _handler.queue_retry(paths)


def _schedule_reconcile(
    threads_dir: Path,
    loom_dir: Path,
    loop: asyncio.AbstractEventLoop | None = None,
    *,
    generation: int | None = None,
) -> None:
    """Schedule a periodic *differential* index reconcile.

    Replaces the old 30-minute full reindex (which dropped the table and
    re-embedded every chunk — continuous embedding spend, an empty index during
    each rebuild, and a hard wall at the timeout). ``reconcile_vault`` only
    embeds notes missing from the store and drops orphaned chunks, so periodic
    drift healing costs almost nothing when the vault is idle.

    A reschedule passes along the chain's ``generation``; if the watcher was
    stopped or restarted since the chain began, the reschedule is a no-op and
    the orphaned chain dies here instead of firing against the new vault.
    """
    global _reconcile_timer

    with _reconcile_lock:
        if generation is None:
            generation = _reconcile_generation
        elif generation != _reconcile_generation:
            # Stale chain from a stopped/superseded watcher — do not
            # reschedule into the new vault's lifetime.
            return

        def _do_reconcile() -> None:
            with _reconcile_lock:
                if generation != _reconcile_generation:
                    # Fired after stop/restart — the cancel lost the race.
                    # Do nothing: the indexer is now bound to another vault.
                    return
            from index.indexer import get_indexer

            indexer = get_indexer()
            if indexer is not None:
                try:
                    if loop is not None and not loop.is_closed():
                        future = asyncio.run_coroutine_threadsafe(
                            indexer.reconcile_vault(threads_dir), loop
                        )
                        future.result(timeout=_RECONCILE_TIMEOUT_SECONDS)
                    else:
                        logger.warning("Event loop unavailable — skipping index reconcile")
                except Exception:
                    logger.warning("Index reconcile failed", exc_info=True)
            # Reschedule — no-op if this chain went stale mid-run.
            _schedule_reconcile(threads_dir, loom_dir, loop, generation=generation)

        _reconcile_timer = threading.Timer(_RECONCILE_SECONDS, _do_reconcile)
        _reconcile_timer.daemon = True
        _reconcile_timer.start()


def start_watcher(
    vault_root: Path,
    loop: asyncio.AbstractEventLoop | None = None,
) -> BaseObserver:
    """Start watching the vault's threads/ directory for .md changes.

    Args:
        vault_root: Root directory of the vault.
        loop: The main asyncio event loop, used for thread-safe async calls.
    """
    global _observer, _handler, _reconcile_timer, _reconcile_generation
    if _observer is not None:
        _observer.stop()
    if _handler is not None:
        _handler.stop()
    with _reconcile_lock:
        # Cancel any pre-existing reconcile chain and invalidate an in-flight
        # reconcile from the previous watcher before starting a new chain.
        _reconcile_generation += 1
        if _reconcile_timer is not None:
            _reconcile_timer.cancel()
            _reconcile_timer = None

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

    # Start periodic differential reconcile
    _schedule_reconcile(threads_dir, loom_dir, loop)

    logger.info("File watcher started for %s", threads_dir)
    return _observer


def stop_watcher() -> None:
    """Stop the active file watcher, worker thread, and reconcile timer."""
    global _observer, _handler, _reconcile_timer, _reconcile_generation
    if _observer is not None:
        _observer.stop()
        _observer = None
    if _handler is not None:
        _handler.stop()
        _handler = None
    with _reconcile_lock:
        # Bump the generation first so a reconcile that is already executing
        # (past the cancel) sees itself as stale and does not reschedule an
        # orphaned chain into the next vault's lifetime.
        _reconcile_generation += 1
        if _reconcile_timer is not None:
            _reconcile_timer.cancel()
            _reconcile_timer = None

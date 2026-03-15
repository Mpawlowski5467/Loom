"""File watcher: rebuild graph.json and update note index on vault changes."""

import logging
import threading
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from core.graph import build_graph, save_graph
from core.note_index import get_note_index

logger = logging.getLogger(__name__)

_DEBOUNCE_SECONDS = 0.5


class _VaultEventHandler(FileSystemEventHandler):
    """Updates note index immediately and debounces graph rebuilds."""

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
            self._schedule_rebuild()

    def on_modified(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._index.refresh_file(Path(event.src_path))
            self._schedule_rebuild()

    def on_deleted(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._index.remove_file(Path(event.src_path))
            self._schedule_rebuild()

    def on_moved(self, event: FileSystemEvent) -> None:
        src = str(event.src_path)
        dest = str(event.dest_path)
        if src.endswith(".md") or dest.endswith(".md"):
            self._index.move_file(Path(src), Path(dest))
            self._schedule_rebuild()

    def _schedule_rebuild(self) -> None:
        """Debounce graph rebuilds — wait for changes to settle."""
        with self._timer_lock:
            if self._rebuild_timer is not None:
                self._rebuild_timer.cancel()
            self._rebuild_timer = threading.Timer(
                _DEBOUNCE_SECONDS, self._rebuild,
            )
            self._rebuild_timer.daemon = True
            self._rebuild_timer.start()

    def _rebuild(self) -> None:
        logger.info("Vault change detected — rebuilding graph.json")
        graph = build_graph(self._threads_dir)
        save_graph(graph, self._loom_dir)


_observer: Observer | None = None


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
    logger.info("File watcher started for %s", threads_dir)
    return _observer


def stop_watcher() -> None:
    """Stop the active file watcher."""
    global _observer
    if _observer is not None:
        _observer.stop()
        _observer = None

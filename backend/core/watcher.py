"""File watcher: rebuild graph.json on vault file changes."""

import logging
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from core.graph import build_graph, save_graph

logger = logging.getLogger(__name__)


class _VaultEventHandler(FileSystemEventHandler):
    """Rebuilds graph.json when .md files change in threads/."""

    def __init__(self, threads_dir: Path, loom_dir: Path) -> None:
        self._threads_dir = threads_dir
        self._loom_dir = loom_dir

    def _is_md(self, event: FileSystemEvent) -> bool:
        return str(event.src_path).endswith(".md")

    def on_created(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._rebuild()

    def on_modified(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._rebuild()

    def on_deleted(self, event: FileSystemEvent) -> None:
        if self._is_md(event):
            self._rebuild()

    def on_moved(self, event: FileSystemEvent) -> None:
        if str(event.src_path).endswith(".md") or str(event.dest_path).endswith(".md"):
            self._rebuild()

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

"""In-memory note metadata index for O(1) lookups by id/title."""

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

from core.notes import NoteMeta, parse_note_meta

logger = logging.getLogger(__name__)


@dataclass
class IndexEntry:
    """Cached note metadata with file path and mtime."""

    id: str
    title: str
    type: str
    tags: list[str]
    file_path: Path
    mtime: float
    meta: NoteMeta


@dataclass
class NoteIndex:
    """In-memory index of all vault notes for fast lookups.

    Thread-safe via a reentrant lock. The watcher thread calls
    ``refresh_file`` / ``remove_file`` while the main thread serves
    API requests through the lookup methods.
    """

    _by_id: dict[str, IndexEntry] = field(default_factory=dict)
    _by_path: dict[Path, IndexEntry] = field(default_factory=dict)
    _by_title: dict[str, IndexEntry] = field(default_factory=dict)  # lowered title -> entry
    _lock: threading.RLock = field(default_factory=threading.RLock)

    # -- Build / rebuild ------------------------------------------------------

    def build(self, threads_dir: Path) -> None:
        """Full scan of threads/ to populate the index."""
        if not threads_dir.exists():
            return

        entries: list[IndexEntry] = []
        for md in threads_dir.rglob("*.md"):
            if ".archive" in md.parts:
                continue
            entry = self._parse_entry(md)
            if entry:
                entries.append(entry)

        with self._lock:
            self._by_id.clear()
            self._by_path.clear()
            self._by_title.clear()
            for e in entries:
                self._insert(e)

        logger.info("Note index built: %d notes", len(entries))

    # -- Incremental updates --------------------------------------------------

    def refresh_file(self, path: Path) -> None:
        """Re-parse a single file and update the index."""
        with self._lock:
            old = self._by_path.get(path)
            if old:
                self._remove_entry(old)

        entry = self._parse_entry(path)
        if entry:
            with self._lock:
                self._insert(entry)

    def remove_file(self, path: Path) -> None:
        """Remove a file from the index (deleted or moved away)."""
        with self._lock:
            old = self._by_path.get(path)
            if old:
                self._remove_entry(old)

    def move_file(self, src: Path, dest: Path) -> None:
        """Handle a file move/rename."""
        self.remove_file(src)
        if dest.suffix == ".md" and ".archive" not in dest.parts:
            self.refresh_file(dest)

    # -- Lookups --------------------------------------------------------------

    def get_by_id(self, note_id: str) -> IndexEntry | None:
        """O(1) lookup by note id."""
        with self._lock:
            return self._by_id.get(note_id)

    def get_by_title(self, title: str) -> IndexEntry | None:
        """Case-insensitive lookup by title."""
        with self._lock:
            return self._by_title.get(title.lower())

    def get_path_by_id(self, note_id: str) -> Path | None:
        """Return the file path for a note id, or None."""
        entry = self.get_by_id(note_id)
        return entry.file_path if entry else None

    def get_by_path(self, path: Path) -> IndexEntry | None:
        """Lookup by file path."""
        with self._lock:
            return self._by_path.get(path)

    def all_entries(self) -> list[IndexEntry]:
        """Return a snapshot of all index entries."""
        with self._lock:
            return list(self._by_id.values())

    def all_metas(self) -> list[NoteMeta]:
        """Return a snapshot of all cached NoteMeta objects."""
        with self._lock:
            return [e.meta for e in self._by_id.values()]

    @property
    def size(self) -> int:
        """Number of indexed notes."""
        with self._lock:
            return len(self._by_id)

    def get_title_map(self) -> dict[str, Path]:
        """Return a {lowercase_title: file_path} map from cached data.

        Used by ReadChain and Spider to avoid redundant rglob scans.
        """
        with self._lock:
            return {
                title: entry.file_path
                for title, entry in self._by_title.items()
            }

    def get_title_set(self) -> set[str]:
        """Return a set of lowercase note titles from cached data.

        Used by Archivist to avoid redundant rglob scans.
        """
        with self._lock:
            return set(self._by_title.keys())

    # -- Internal helpers -----------------------------------------------------

    def _parse_entry(self, path: Path) -> IndexEntry | None:
        """Parse a .md file into an IndexEntry, or None on failure."""
        try:
            if not path.exists():
                return None
            meta = parse_note_meta(path)
            if not meta.id:
                return None
            return IndexEntry(
                id=meta.id,
                title=meta.title,
                type=meta.type,
                tags=list(meta.tags),
                file_path=path,
                mtime=path.stat().st_mtime,
                meta=meta,
            )
        except Exception:  # noqa: BLE001
            logger.debug("Failed to parse %s for index", path)
            return None

    def _insert(self, entry: IndexEntry) -> None:
        """Insert an entry into all lookup dicts. Caller must hold lock."""
        self._by_id[entry.id] = entry
        self._by_path[entry.file_path] = entry
        if entry.title:
            self._by_title[entry.title.lower()] = entry

    def _remove_entry(self, entry: IndexEntry) -> None:
        """Remove an entry from all lookup dicts. Caller must hold lock."""
        self._by_id.pop(entry.id, None)
        self._by_path.pop(entry.file_path, None)
        if entry.title:
            self._by_title.pop(entry.title.lower(), None)


# -- Module-level singleton ---------------------------------------------------

_note_index: NoteIndex | None = None


def get_note_index() -> NoteIndex:
    """Return the global NoteIndex singleton."""
    global _note_index
    if _note_index is None:
        _note_index = NoteIndex()
    return _note_index

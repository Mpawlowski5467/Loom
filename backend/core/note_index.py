"""In-memory note metadata index for O(1) lookups by id/title."""

import json
import logging
import re
import sqlite3
import threading
from dataclasses import dataclass, field
from pathlib import Path

from core.notes import NoteMeta, is_published, parse_note
from core.wikilinks import link_target, unique_link_map

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
    body: str = ""


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
    _links: dict[str, Path] | None = field(default=None)
    _lexical: sqlite3.Connection | None = field(default=None, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock)

    # -- Build / rebuild ------------------------------------------------------

    def build(self, threads_dir: Path) -> None:
        """Full scan of threads/ to populate the index."""
        if not threads_dir.exists():
            with self._lock:
                self._by_id.clear()
                self._by_path.clear()
                self._by_title.clear()
                self._links = None
                self._reset_lexical()
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
            self._links = None
            self._reset_lexical()
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
        """Return a title match only when it identifies exactly one note."""
        with self._lock:
            matches = [
                entry for entry in self._by_id.values() if entry.title.lower() == title.lower()
            ]
        return matches[0] if len(matches) == 1 else None

    def resolve_wikilink(self, raw: str) -> IndexEntry | None:
        """Resolve id/title/slug/path/alias links without guessing ambiguities."""
        key = link_target(raw)
        if not key:
            return None
        with self._lock:
            if self._links is None:
                self._links = unique_link_map(
                    (entry.meta, entry.file_path) for entry in self._by_id.values()
                )
            path = self._links.get(key)
            return self._by_path.get(path) if path is not None else None

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
        """Return canonical unambiguous wikilink keys mapped to file paths.

        Used by ReadChain and Spider to avoid redundant rglob scans.
        """
        with self._lock:
            if self._links is None:
                self._links = unique_link_map(
                    (entry.meta, entry.file_path) for entry in self._by_id.values()
                )
            return dict(self._links)

    def get_title_set(self) -> set[str]:
        """Return a set of lowercase note titles from cached data.

        Used by Archivist to avoid redundant rglob scans.
        """
        with self._lock:
            return set(self._by_title.keys())

    def lexical_search(
        self,
        query: str,
        note_type: str | None = None,
        tags: list[str] | None = None,
        limit: int = 80,
    ) -> list[tuple[IndexEntry, float]]:
        """FTS5 word/prefix retrieval with filters before ranking and limiting.

        The index is rebuilt from the Markdown-backed snapshot on first query,
        then kept current with watcher updates. It is disposable runtime state.
        """
        tokens = re.findall(r"\w+", query, re.UNICODE)[:32]
        if not tokens:
            return []
        expression = " OR ".join('"' + token.replace('"', '""') + '"*' for token in tokens)
        with self._lock:
            if self._lexical is None:
                self._lexical = sqlite3.connect(":memory:", check_same_thread=False)
                self._lexical.execute(
                    "CREATE VIRTUAL TABLE notes_fts USING fts5(note_id UNINDEXED, title, body, tags, note_type UNINDEXED, tag_json UNINDEXED, tokenize='unicode61 remove_diacritics 2')"
                )
                for entry in self._by_id.values():
                    self._lexical_insert(entry)
            where, values = ["notes_fts MATCH ?"], [expression]
            if note_type:
                where.append("note_type=?")
                values.append(note_type)
            for tag in tags or []:
                where.append("EXISTS (SELECT 1 FROM json_each(notes_fts.tag_json) WHERE value=?)")
                values.append(tag)
            rows = self._lexical.execute(
                "SELECT note_id,bm25(notes_fts,0,8,1,3,0,0) FROM notes_fts WHERE "
                + " AND ".join(where)
                + " ORDER BY bm25(notes_fts,0,8,1,3,0,0),note_id LIMIT ?",
                (*values, limit),
            ).fetchall()
            return [
                (self._by_id[str(note_id)], -float(rank))
                for note_id, rank in rows
                if str(note_id) in self._by_id
            ]

    def _reset_lexical(self) -> None:
        if self._lexical is not None:
            self._lexical.close()
            self._lexical = None

    def _lexical_insert(self, entry: IndexEntry) -> None:
        if self._lexical is not None:
            self._lexical.execute("DELETE FROM notes_fts WHERE note_id=?", (entry.id,))
            self._lexical.execute(
                "INSERT INTO notes_fts VALUES(?,?,?,?,?,?)",
                (
                    entry.id,
                    entry.title,
                    entry.body,
                    " ".join(entry.tags),
                    entry.type,
                    json.dumps(entry.tags),
                ),
            )

    def get_tag_set(self) -> set[str]:
        """Return the union of all tags across indexed notes, lowercased.

        Used by Weaver to snap LLM-generated tags to existing vault
        vocabulary (catches typos like 'rafter' for 'raft').
        """
        with self._lock:
            tags: set[str] = set()
            for entry in self._by_id.values():
                for t in entry.tags:
                    if t:
                        tags.add(t.lower())
            return tags

    # -- Internal helpers -----------------------------------------------------

    def _parse_entry(self, path: Path) -> IndexEntry | None:
        """Parse a .md file into an IndexEntry, or None on failure."""
        try:
            if not path.exists() or ".archive" in path.parts:
                return None
            note = parse_note(path)
            meta = NoteMeta.model_validate(note.model_dump(exclude={"body", "wikilinks"}))
            if not meta.id or not is_published(meta):
                return None
            return IndexEntry(
                id=meta.id,
                title=meta.title,
                type=meta.type,
                tags=list(meta.tags),
                file_path=path,
                mtime=path.stat().st_mtime,
                meta=meta,
                body=note.body,
            )
        except Exception:  # noqa: BLE001
            logger.debug("Failed to parse %s for index", path)
            return None

    def _insert(self, entry: IndexEntry) -> None:
        """Insert an entry into all lookup dicts. Caller must hold lock."""
        self._links = None
        self._lexical_insert(entry)
        self._by_id[entry.id] = entry
        self._by_path[entry.file_path] = entry
        if entry.title:
            self._by_title[entry.title.lower()] = entry

    def _remove_entry(self, entry: IndexEntry) -> None:
        """Remove an entry from all lookup dicts. Caller must hold lock."""
        self._links = None
        if self._lexical is not None:
            self._lexical.execute("DELETE FROM notes_fts WHERE note_id=?", (entry.id,))
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

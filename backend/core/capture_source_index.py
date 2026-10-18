"""Rebuildable SQLite lookup for capture producer identity."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from yaml import YAMLError

from core.notes import Note, parse_note

_LOCKS_GUARD = threading.Lock()
_LOCKS: dict[Path, threading.RLock] = {}


class CaptureSourceIndex:
    """Maps a ``source`` + ``external_id`` pair to its capture file."""

    def __init__(self, vault_root: Path) -> None:
        self._root = vault_root.resolve()
        self._path = self._root / ".loom" / "capture-sources.sqlite"
        with _LOCKS_GUARD:
            self._lock = _LOCKS.setdefault(self._root, threading.RLock())

    def find(self, source: str, external_id: str) -> Note | None:
        """Return a matching capture, rebuilding only when state is stale."""
        with self._lock:
            self._ensure()
            found = self._lookup(source, external_id)
            if found is not None:
                return found
            if not self._is_built():
                self.rebuild()
                return self._lookup(source, external_id)
            return None

    def record(self, note: Note) -> None:
        """Upsert one capture after a successful ingress write."""
        external_id = note.extra.get("external_id")
        if note.type != "capture" or not isinstance(external_id, str) or not external_id:
            return
        with self._lock:
            self._ensure()
            with self._connect() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO captures(source, external_id, path) VALUES (?, ?, ?)",
                    (note.source, external_id, str(Path(note.file_path).resolve())),
                )
            # A single ingress write is not evidence that every legacy capture
            # has been indexed. Only a full rebuild sets the built marker.

    def rebuild(self) -> int:
        """Rebuild the lookup from Markdown, including archived captures."""
        with self._lock:
            return self._rebuild_locked()

    def _rebuild_locked(self) -> int:
        self._ensure()
        rows: list[tuple[str, str, str]] = []
        threads = self._root / "threads"
        if threads.exists():
            for path in threads.rglob("*.md"):
                if path.is_symlink() or not path.resolve().is_relative_to(threads.resolve()):
                    continue
                try:
                    note = parse_note(path)
                except (OSError, ValueError, YAMLError):
                    continue
                external_id = note.extra.get("external_id")
                if note.type == "capture" and isinstance(external_id, str) and external_id:
                    rows.append((note.source, external_id, str(path.resolve())))
        with self._connect() as conn:
            conn.execute("DELETE FROM captures")
            conn.executemany(
                "INSERT OR REPLACE INTO captures(source, external_id, path) VALUES (?, ?, ?)", rows
            )
            conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('built', '1')")
        return len(rows)

    def refresh_path(self, path: Path) -> None:
        """Incrementally reflect a watcher event without a vault-wide scan."""
        if path.is_symlink() or not path.resolve().is_relative_to(self._root / "threads"):
            return
        with self._lock:
            path = path.resolve()
            self._ensure()
            with self._connect() as conn:
                conn.execute("DELETE FROM captures WHERE path = ?", (str(path),))
            try:
                self.record(parse_note(path))
            except (OSError, ValueError, YAMLError):
                return

    def _lookup(self, source: str, external_id: str) -> Note | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT path FROM captures WHERE source = ? AND external_id = ?",
                (source, external_id),
            ).fetchone()
        if row is None:
            return None
        path = Path(row[0])
        try:
            path.resolve().relative_to(self._root / "threads")
            note = parse_note(path)
        except (OSError, ValueError, YAMLError):
            # An archive/move can race this read. Rebuild once from Markdown.
            self.rebuild()
            return self._lookup_after_rebuild(source, external_id)
        external = note.extra.get("external_id")
        return (
            note
            if note.type == "capture" and note.source == source and external == external_id
            else None
        )

    def _lookup_after_rebuild(self, source: str, external_id: str) -> Note | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT path FROM captures WHERE source = ? AND external_id = ?",
                (source, external_id),
            ).fetchone()
        if row is None:
            return None
        try:
            path = Path(row[0])
            path.resolve().relative_to(self._root / "threads")
            note = parse_note(path)
            return (
                note
                if note.type == "capture"
                and note.source == source
                and note.extra.get("external_id") == external_id
                else None
            )
        except (OSError, ValueError, YAMLError):
            return None

    def _is_built(self) -> bool:
        with self._connect() as conn:
            return conn.execute("SELECT value FROM meta WHERE key = 'built'").fetchone() is not None

    def _ensure(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS captures (source TEXT, external_id TEXT, path TEXT, "
                "PRIMARY KEY(source, external_id))"
            )
            conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

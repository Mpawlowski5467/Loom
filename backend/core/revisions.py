"""Durable content revisions and conflict-checked, whole-run rollback.

Markdown remains authoritative. A prepared journal survives a process crash;
recovery completes an already-applied write or rolls back a partial batch only
when every file still matches one of the recorded versions. External edits
never get overwritten during recovery.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, TypeVar

import yaml

from core.archive_paths import ARCHIVE_ORIGINAL_PATH_FIELD
from core.history import on_mutation
from core.notes import atomic_write_text, note_to_file_content, now_iso
from core.traces import get_caller, get_run

T = TypeVar("T")
_LOCK = threading.RLock()


class RevisionConflict(ValueError):
    """The current files no longer match the version being changed."""


def fingerprint(content: str | None) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest() if content is not None else "missing"


def _path(vault: Path, relative: str) -> Path:
    raw = Path(relative)
    if raw.is_absolute() or ".." in raw.parts or "\\" in relative or raw.suffix != ".md":
        raise RevisionConflict("Unsafe revision path")
    root = (vault / "threads").resolve()
    result = root / raw
    if result.is_symlink() or not result.resolve().is_relative_to(root):
        raise RevisionConflict("Revision path escapes the vault")
    return result


def _read(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.exists() else None


@contextmanager
def _db(vault: Path) -> Iterator[sqlite3.Connection]:
    directory = vault / ".loom"
    directory.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(directory / "revisions.sqlite3", timeout=30)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS revisions (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
            run_id TEXT NOT NULL, caller TEXT NOT NULL, created TEXT NOT NULL,
            state TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS revision_notes (revision_id TEXT, note_id TEXT,
            PRIMARY KEY(revision_id, note_id));
        CREATE INDEX IF NOT EXISTS revision_note_id ON revision_notes(note_id);
        CREATE INDEX IF NOT EXISTS revision_run ON revisions(run_id);
    """)
    try:
        yield conn
    finally:
        conn.close()


def _note_ids(contents: list[str | None]) -> set[str]:
    result: set[str] = set()
    for text in contents:
        if not text or not text.startswith("---\n"):
            continue
        try:
            meta = yaml.safe_load(text.split("---", 2)[1])
            if isinstance(meta, dict) and isinstance(meta.get("id"), str):
                result.add(meta["id"])
        except (yaml.YAMLError, IndexError):
            continue
    return result


def _restore_files(vault: Path, contents: dict[str, str | None]) -> None:
    # Existing versions are restored first. Removing a path is used only for
    # transaction rollback/moves; its bytes are already in the durable journal.
    for rel, content in contents.items():
        path = _path(vault, rel)
        if content is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_text(path, content)
    for rel, content in contents.items():
        if content is None:
            _path(vault, rel).unlink(missing_ok=True)


def _recover(vault: Path, conn: sqlite3.Connection) -> None:
    for row in conn.execute("SELECT * FROM revisions WHERE state='prepared' ORDER BY seq"):
        before, after = json.loads(row["before_json"]), json.loads(row["after_json"])
        current = {rel: _read(_path(vault, rel)) for rel in before}
        if current == after:
            state = "applied"
        elif current == before:
            state = "aborted"
        elif all(current[rel] in (before[rel], after[rel]) for rel in before):
            _restore_files(vault, before)
            state = "aborted"
        else:
            raise RevisionConflict(
                f"Interrupted revision {row['id']} conflicts with an external edit; "
                "preserved all files and the revision journal for recovery."
            )
        conn.execute("UPDATE revisions SET state=? WHERE id=?", (state, row["id"]))
        conn.commit()


def recover(vault: Path) -> None:
    with _LOCK, _db(vault) as conn:
        _recover(vault, conn)


def export_snapshot(vault: Path, destination: Path) -> bool:
    """Copy a consistent SQLite image, including WAL entries, into an export."""
    if not (vault / ".loom" / "revisions.sqlite3").exists():
        return False
    with _LOCK, _db(vault) as conn:
        _recover(vault, conn)
        backup = sqlite3.connect(destination)
        try:
            conn.backup(backup)
        finally:
            backup.close()
    return True


def record_mutation(
    vault: Path,
    changes: dict[Path, str | None],
    action: Callable[[], T],
    *,
    caller: str = "",
    run_id: str | None = None,
) -> T:
    """Journal the exact versions before invoking one write or atomic move."""
    with _LOCK, _db(vault) as conn:
        _recover(vault, conn)
        after = {
            path.relative_to((vault / "threads").resolve()).as_posix(): text
            for path, text in changes.items()
        }
        before = {rel: _read(_path(vault, rel)) for rel in after}
        if before == after:
            return action()
        revision_id = "rev_" + uuid.uuid4().hex
        effective_run = get_run() if run_id is None else run_id
        effective_caller = caller or get_caller()
        conn.execute(
            "INSERT INTO revisions(id,run_id,caller,created,state,before_json,after_json) VALUES(?,?,?,?,?,?,?)",
            (
                revision_id,
                effective_run,
                effective_caller or "user",
                now_iso(),
                "prepared",
                json.dumps(before),
                json.dumps(after),
            ),
        )
        conn.executemany(
            "INSERT INTO revision_notes VALUES(?,?)",
            [(revision_id, note_id) for note_id in _note_ids([*before.values(), *after.values()])],
        )
        conn.commit()
        try:
            result = action()
        except BaseException:
            _recover(vault, conn)
            raise
        conn.execute("UPDATE revisions SET state='applied' WHERE id=?", (revision_id,))
        conn.commit()
        on_mutation(vault, before, after, caller=effective_caller, run_id=effective_run)
        return result


def record_move(vault: Path, source: Path, destination: Path) -> None:
    source, destination = source.resolve(), destination.resolve()
    if destination.exists():
        raise FileExistsError(destination)
    record_mutation(
        vault, {source: None, destination: _read(source)}, lambda: source.rename(destination)
    )


def list_revisions(vault: Path, note_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with _LOCK, _db(vault) as conn:
        _recover(vault, conn)
        rows = conn.execute(
            "SELECT r.id,r.run_id,r.caller,r.created FROM revisions r JOIN revision_notes n ON n.revision_id=r.id WHERE n.note_id=? AND r.state='applied' ORDER BY r.seq DESC LIMIT ?",
            (note_id, limit),
        )
        return [dict(row) for row in rows]


def get_revision(vault: Path, revision_id: str) -> dict[str, Any]:
    with _LOCK, _db(vault) as conn:
        _recover(vault, conn)
        row = conn.execute(
            "SELECT * FROM revisions WHERE id=? AND state='applied'", (revision_id,)
        ).fetchone()
        if row is None:
            raise KeyError(revision_id)
        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "caller": row["caller"],
            "created": row["created"],
            "before": json.loads(row["before_json"]),
            "after": json.loads(row["after_json"]),
        }


def run_changes(vault: Path, run_id: str) -> dict[str, Any]:
    if not run_id:
        raise KeyError(run_id)
    with _LOCK, _db(vault) as conn:
        _recover(vault, conn)
        rows = conn.execute(
            "SELECT * FROM revisions WHERE run_id=? AND state='applied' ORDER BY seq", (run_id,)
        ).fetchall()
        if not rows:
            raise KeyError(run_id)
        before: dict[str, str | None] = {}
        after: dict[str, str | None] = {}
        for row in rows:
            for rel, text in json.loads(row["before_json"]).items():
                before.setdefault(rel, text)
            after.update(json.loads(row["after_json"]))
        paths = {rel for rel in before if before[rel] != after[rel]}
        return {
            "run_id": run_id,
            "before": {p: before[p] for p in sorted(paths)},
            "after": {p: after[p] for p in sorted(paths)},
        }


def preview(vault: Path, change: dict[str, Any]) -> dict[str, Any]:
    files = []
    for rel, expected in change["after"].items():
        current = _read(_path(vault, rel))
        files.append(
            {
                "path": rel,
                "before": change["before"][rel],
                "after": expected,
                "current_hash": fingerprint(current),
                "conflict": current != expected,
            }
        )
    return {"files": files, "conflicts": [f["path"] for f in files if f["conflict"]]}


def undo(vault: Path, change: dict[str, Any], expected_hashes: dict[str, str]) -> None:
    """Undo an entire run under caller-held path locks; all-or-nothing on error."""
    with _LOCK:
        current = {rel: _read(_path(vault, rel)) for rel in change["after"]}
        if set(current) != set(expected_hashes) or any(
            text != change["after"][rel] or fingerprint(text) != expected_hashes[rel]
            for rel, text in current.items()
        ):
            raise RevisionConflict(
                "A file changed after this run or preview. No changes were applied."
            )
        target = archive_removed_notes(
            dict(change["before"]),
            current,
            f"undo-{uuid.uuid4().hex[:12]}",
            f"Undid run {change.get('run_id', '')}",
        )
        apply_contents(vault, target, caller="user:undo")


def archive_removed_notes(
    target: dict[str, str | None],
    current: dict[str, str | None],
    archive_dir: str,
    reason: str,
) -> dict[str, str | None]:
    """Turn removals of existing notes into moves under ``.archive/<archive_dir>/``.

    Deletion is archival in Loom: a note an undo or revert would remove is kept
    as an archived copy carrying its original path and an audit entry.
    """
    result = dict(target)
    for rel, text in current.items():
        if result.get(rel, text) is None and text is not None and not rel.startswith(".archive/"):
            parts = text.split("---", 2)
            meta = yaml.safe_load(parts[1]) if len(parts) == 3 else None
            if not isinstance(meta, dict):
                raise RevisionConflict(
                    f"Cannot remove non-note file '{rel}'; archive it manually first."
                )
            ts = now_iso()
            meta[ARCHIVE_ORIGINAL_PATH_FIELD] = rel
            meta["status"] = "archived"
            meta["modified"] = ts
            meta.setdefault("history", []).append(
                {"action": "archived", "by": "user", "at": ts, "reason": reason}
            )
            result[f".archive/{archive_dir}/{rel}"] = note_to_file_content(
                meta, parts[2].lstrip("\n")
            )
    return result


def apply_contents(vault: Path, target: dict[str, str | None], *, caller: str) -> None:
    """Journal and write threads-relative contents (None removes) as one revision."""
    changes = {_path(vault, rel): text for rel, text in target.items()}
    record_mutation(vault, changes, lambda: _restore_files(vault, target), caller=caller, run_id="")


def restore(vault: Path, path: Path, content: str, expected_hash: str) -> None:
    with _LOCK:
        if fingerprint(_read(path)) != expected_hash:
            raise RevisionConflict(
                "The note changed after the preview. Reload its history and try again."
            )
        record_mutation(
            vault,
            {path.resolve(): content},
            lambda: atomic_write_text(path, content),
            caller="user:restore",
            run_id="",
        )

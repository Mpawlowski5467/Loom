"""Note parser: extract YAML frontmatter, markdown body, and wikilinks."""

import os
import re
import secrets
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

# The closing fence tolerates end-of-string: a note whose final byte is the
# closing ``---`` (no trailing newline) must still parse its frontmatter —
# otherwise the note silently gets empty meta (id="" → invisible to NoteIndex).
_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---(?:\s*\n|\s*$)", re.DOTALL)
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


class HistoryEntry(BaseModel):
    """A single edit-history record stored in frontmatter."""

    action: str
    by: str
    at: str
    reason: str = ""


# Bump when the on-disk note frontmatter schema changes in a way that needs
# migration. Stamped onto notes when absent so future format changes have a
# value to dispatch on.
NOTE_SCHEMA_VERSION = 1


class NoteMeta(BaseModel):
    """Frontmatter fields (returned in list views, no body)."""

    id: str = ""
    title: str = ""
    type: str = ""
    tags: list[str] = Field(default_factory=list)
    created: str = ""
    modified: str = ""
    author: str = "user"
    source: str = ""
    links: list[str] = Field(default_factory=list)
    status: str = "active"
    history: list[HistoryEntry] = Field(default_factory=list)
    schema_version: int = NOTE_SCHEMA_VERSION
    # Unknown frontmatter keys (user-added custom fields) preserved verbatim so
    # an agent round-trip (parse → mutate known fields → write) never silently
    # drops them. Hoisted back to top-level frontmatter by ``build_frontmatter``.
    extra: dict[str, Any] = Field(default_factory=dict)
    # Derived at parse time — not stored in frontmatter
    file_path: str = ""


class Note(NoteMeta):
    """Full note: frontmatter + body + extracted wikilinks."""

    body: str = ""
    wikilinks: list[str] = Field(default_factory=list)


def generate_id() -> str:
    """Generate a note id like ``thr_a1b2c3``."""
    return f"thr_{secrets.token_hex(3)}"


def now_iso() -> str:
    """Return the current UTC time in ISO-8601 format."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def _coerce_meta(meta: dict[str, Any]) -> dict[str, Any]:
    """Coerce YAML-auto-typed values (datetimes, ints) to strings where needed."""
    str_fields = {"id", "title", "type", "created", "modified", "author", "source", "status"}
    out: dict[str, Any] = {}
    for k, v in meta.items():
        if k in str_fields and not isinstance(v, str):
            out[k] = str(v) if v is not None else ""
        elif k == "history" and isinstance(v, list):
            out[k] = [
                {
                    hk: str(hv) if hk == "at" and not isinstance(hv, str) else hv
                    for hk, hv in entry.items()
                }
                if isinstance(entry, dict)
                else entry
                for entry in v
            ]
        else:
            out[k] = v
    return out


def _split_known_extra(meta: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Partition a frontmatter mapping into known model fields and extras.

    Keys not recognized by ``NoteMeta`` are user-added custom frontmatter and
    are preserved separately so they survive an agent round-trip.
    """
    known: dict[str, Any] = {}
    extra: dict[str, Any] = {}
    for k, v in meta.items():
        if k in NoteMeta.model_fields and k not in {"extra", "file_path"}:
            known[k] = v
        else:
            extra[k] = v
    return known, extra


def parse_note(path: Path) -> Note:
    """Parse a markdown file into a Note model."""
    text = path.read_text(encoding="utf-8")
    meta: dict[str, Any] = {}
    body = text

    fm_match = _FRONTMATTER_RE.match(text)
    if fm_match:
        loaded = yaml.safe_load(fm_match.group(1))
        # Frontmatter that isn't a mapping (e.g. a bare scalar between the
        # fences) would blow up downstream ``.items()`` / field access — treat
        # it as empty rather than letting one malformed note crash callers.
        meta = _coerce_meta(loaded) if isinstance(loaded, dict) else {}
        body = text[fm_match.end() :]

    wikilinks = _WIKILINK_RE.findall(body)
    known, extra = _split_known_extra(meta)

    return Note(
        **known,
        extra=extra,
        body=body,
        wikilinks=wikilinks,
        file_path=str(path),
    )


def parse_note_meta(path: Path) -> NoteMeta:
    """Parse only frontmatter (skip body) for listing endpoints."""
    text = path.read_text(encoding="utf-8")
    meta: dict[str, Any] = {}

    fm_match = _FRONTMATTER_RE.match(text)
    if fm_match:
        loaded = yaml.safe_load(fm_match.group(1))
        meta = _coerce_meta(loaded) if isinstance(loaded, dict) else {}

    known, extra = _split_known_extra(meta)

    return NoteMeta(
        **known,
        extra=extra,
        file_path=str(path),
    )


def build_frontmatter(meta: dict[str, Any]) -> str:
    """Serialize a dict into a YAML frontmatter block.

    ``extra`` (preserved unknown user fields) is hoisted back to top-level
    keys, and the derived ``file_path`` is never serialized. Known fields take
    precedence over extras on the (by-construction impossible) key collision.
    """
    out = {k: v for k, v in meta.items() if k not in {"extra", "file_path"}}
    extra = meta.get("extra") or {}
    if isinstance(extra, dict):
        for k, v in extra.items():
            out.setdefault(k, v)
    dumped: str = yaml.safe_dump(out, default_flow_style=False, sort_keys=False)
    return "---\n" + dumped + "---\n"


def note_to_file_content(meta: dict[str, Any], body: str) -> str:
    """Combine frontmatter dict and body into a full markdown string."""
    return build_frontmatter(meta) + "\n" + body


def atomic_write_text(
    path: Path,
    content: str,
    encoding: str = "utf-8",
    *,
    mark_graph_dirty: bool = True,
) -> None:
    """Write ``content`` to ``path`` atomically.

    Writes to a uniquely-named temp file in the same directory (``mkstemp``,
    so concurrent same-path writers can never interleave on a shared staging
    name), fsyncs it, then ``os.replace``s it onto ``path``. This prevents
    readers (e.g. the file watcher's indexer) from observing partially-written
    content during concurrent edits. The staged file is always cleaned up on
    failure.

    If ``mark_graph_dirty`` is True (default) and the path is inside a Loom
    vault (recognised by the presence of a ``.loom`` directory above it),
    the graph dirty-flag is set so the next graph read rebuilds.
    """
    fd, raw_tmp = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    tmp = Path(raw_tmp)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        # On success the rename already consumed the temp path; on failure make
        # sure the staged file doesn't linger next to the destination.
        tmp.unlink(missing_ok=True)

    if mark_graph_dirty:
        loom_dir = _find_loom_dir(path)
        if loom_dir is not None:
            # Local import keeps notes.py free of side-effecting imports.
            from core.graph_state import mark_dirty

            mark_dirty(loom_dir)


def _find_loom_dir(path: Path) -> Path | None:
    """Walk up from ``path`` looking for a sibling ``.loom`` directory.

    Returns the ``.loom`` path if found, else None. Used to scope graph
    dirty-flagging to the right vault when a note is written.
    """
    for ancestor in path.resolve().parents:
        candidate = ancestor / ".loom"
        if candidate.is_dir():
            return candidate
    return None

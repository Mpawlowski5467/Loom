"""Note parser: extract YAML frontmatter, markdown body, and wikilinks."""

import os
import re
import secrets
from datetime import UTC, datetime
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


class HistoryEntry(BaseModel):
    """A single edit-history record stored in frontmatter."""

    action: str
    by: str
    at: str
    reason: str = ""


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


def _coerce_meta(meta: dict) -> dict:
    """Coerce YAML-auto-typed values (datetimes, ints) to strings where needed."""
    str_fields = {"id", "title", "type", "created", "modified", "author", "source", "status"}
    out = {}
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


def parse_note(path: Path) -> Note:
    """Parse a markdown file into a Note model."""
    text = path.read_text(encoding="utf-8")
    meta: dict = {}
    body = text

    fm_match = _FRONTMATTER_RE.match(text)
    if fm_match:
        meta = yaml.safe_load(fm_match.group(1)) or {}
        meta = _coerce_meta(meta)
        body = text[fm_match.end() :]

    wikilinks = _WIKILINK_RE.findall(body)

    return Note(
        **{k: v for k, v in meta.items() if k in Note.model_fields},
        body=body,
        wikilinks=wikilinks,
        file_path=str(path),
    )


def parse_note_meta(path: Path) -> NoteMeta:
    """Parse only frontmatter (skip body) for listing endpoints."""
    text = path.read_text(encoding="utf-8")
    meta: dict = {}

    fm_match = _FRONTMATTER_RE.match(text)
    if fm_match:
        meta = yaml.safe_load(fm_match.group(1)) or {}
        meta = _coerce_meta(meta)

    return NoteMeta(
        **{k: v for k, v in meta.items() if k in NoteMeta.model_fields},
        file_path=str(path),
    )


def build_frontmatter(meta: dict) -> str:
    """Serialize a dict into YAML frontmatter block."""
    return "---\n" + yaml.safe_dump(meta, default_flow_style=False, sort_keys=False) + "---\n"


def note_to_file_content(meta: dict, body: str) -> str:
    """Combine frontmatter dict and body into a full markdown string."""
    return build_frontmatter(meta) + "\n" + body


def atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    """Write ``content`` to ``path`` atomically.

    Writes to a temp file in the same directory then ``os.replace``s it onto
    ``path``. This prevents readers (e.g. the file watcher's indexer) from
    observing partially-written content during concurrent edits.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding=encoding)
    os.replace(tmp, path)

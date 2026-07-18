"""Tests for core.notes — note parsing and serialization."""

import concurrent.futures
from pathlib import Path

from core.notes import (
    atomic_write_text,
    generate_id,
    note_to_file_content,
    parse_note,
    parse_note_meta,
)


def test_generate_id_format() -> None:
    nid = generate_id()
    assert nid.startswith("thr_")
    assert len(nid) == 10  # "thr_" + 6 hex chars


def test_parse_note_with_frontmatter(tmp_path: Path) -> None:
    content = """\
---
id: thr_abc123
title: Test Note
type: topic
tags: [python, testing]
created: "2026-01-01T00:00:00+00:00"
modified: "2026-01-01T00:00:00+00:00"
author: user
status: active
history: []
---

## Body

This links to [[Another Note]] and [[Third Note]].
"""
    md = tmp_path / "test-note.md"
    md.write_text(content)

    note = parse_note(md)
    assert note.id == "thr_abc123"
    assert note.title == "Test Note"
    assert note.type == "topic"
    assert note.tags == ["python", "testing"]
    assert "Another Note" in note.wikilinks
    assert "Third Note" in note.wikilinks
    assert "## Body" in note.body


def test_parse_note_meta_skips_body(tmp_path: Path) -> None:
    content = """\
---
id: thr_aaa111
title: Meta Only
type: project
tags: [a, b]
---

Long body here.
"""
    md = tmp_path / "meta.md"
    md.write_text(content)

    meta = parse_note_meta(md)
    assert meta.id == "thr_aaa111"
    assert meta.title == "Meta Only"
    assert not hasattr(meta, "body") or "body" not in meta.model_fields


def test_note_to_file_content_roundtrip(tmp_path: Path) -> None:
    meta = {
        "id": "thr_xyz789",
        "title": "Roundtrip",
        "type": "topic",
        "tags": ["test"],
    }
    body = "## Hello\n\nSome text with [[Link]].\n"
    text = note_to_file_content(meta, body)

    md = tmp_path / "roundtrip.md"
    md.write_text(text)

    note = parse_note(md)
    assert note.id == "thr_xyz789"
    assert note.title == "Roundtrip"
    assert "Link" in note.wikilinks
    assert "## Hello" in note.body


def test_parse_note_frontmatter_without_trailing_newline(tmp_path: Path) -> None:
    """A closing ``---`` fence as the file's last byte must still parse.

    Regression: the old frontmatter regex required a newline after the closing
    fence, so such a note silently parsed with EMPTY frontmatter (id="" →
    invisible to NoteIndex).
    """
    md = tmp_path / "no-trailing-newline.md"
    md.write_text("---\nid: thr_eof001\ntitle: EOF Edge\ntype: topic\n---")

    note = parse_note(md)
    assert note.id == "thr_eof001"
    assert note.title == "EOF Edge"
    assert note.type == "topic"
    assert note.body == ""

    meta = parse_note_meta(md)
    assert meta.id == "thr_eof001"
    assert meta.title == "EOF Edge"


def test_parse_note_frontmatter_still_parses_with_body(tmp_path: Path) -> None:
    """The EOF-tolerant closing fence must not swallow a normal body."""
    md = tmp_path / "normal.md"
    md.write_text("---\nid: thr_eof002\ntitle: Normal\n---\n\n## Body\n")

    note = parse_note(md)
    assert note.id == "thr_eof002"
    assert "## Body" in note.body


def test_atomic_write_text_concurrent_same_path_writers(tmp_path: Path) -> None:
    """Concurrent writers to one path must not interleave on a shared tmp name.

    The old deterministic ``<name>.tmp`` staging let two writers rename each
    other's half-written file (FileNotFoundError / mixed content). ``mkstemp``
    gives every writer a private staging file.
    """
    target = tmp_path / "race.md"
    writers = 16
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(
            pool.map(
                lambda i: atomic_write_text(target, f"content-{i}", mark_graph_dirty=False),
                range(writers),
            )
        )

    # The last replacer wins; the content is always one complete write, never
    # a mixture, and no staging files are left behind.
    assert target.read_text(encoding="utf-8") in {f"content-{i}" for i in range(writers)}
    assert list(tmp_path.glob("*.tmp")) == []

"""Tests for core.notes — note parsing and serialization."""

from pathlib import Path

from core.notes import (
    build_frontmatter,
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

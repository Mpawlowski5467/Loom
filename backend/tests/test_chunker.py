"""Tests for index/chunker.py — markdown note chunking."""

from core.notes import Note
from index.chunker import chunk_note


def _make_note(body: str, **kwargs) -> Note:
    defaults = {
        "id": "thr_abc123",
        "title": "Test Note",
        "type": "topic",
        "tags": ["test", "demo"],
        "body": body,
    }
    defaults.update(kwargs)
    return Note(**defaults)


class TestChunkNote:
    def test_no_headers_single_chunk(self):
        note = _make_note("Just some text without any headers.")
        chunks = chunk_note(note)
        assert len(chunks) == 1
        assert chunks[0].heading == ""
        assert chunks[0].chunk_index == 0
        assert chunks[0].note_id == "thr_abc123"

    def test_single_header(self):
        note = _make_note("## Section One\n\nContent of section one.")
        chunks = chunk_note(note)
        assert len(chunks) == 1
        assert chunks[0].heading == "Section One"
        assert "Content of section one" in chunks[0].body

    def test_multiple_headers(self):
        body = (
            "## Overview\n\nFirst section.\n\n"
            "## Details\n\nSecond section.\n\n"
            "## Conclusion\n\nThird section.\n"
        )
        note = _make_note(body)
        chunks = chunk_note(note)
        assert len(chunks) == 3
        assert chunks[0].heading == "Overview"
        assert chunks[1].heading == "Details"
        assert chunks[2].heading == "Conclusion"
        assert chunks[0].chunk_index == 0
        assert chunks[1].chunk_index == 1
        assert chunks[2].chunk_index == 2

    def test_preamble_before_first_header(self):
        body = "Some preamble text.\n\n## Section\n\nSection content."
        note = _make_note(body)
        chunks = chunk_note(note)
        assert len(chunks) == 2
        assert chunks[0].heading == ""
        assert "preamble" in chunks[0].body
        assert chunks[1].heading == "Section"

    def test_embed_text_includes_tags_and_title(self):
        note = _make_note("## Intro\n\nHello world.", tags=["alpha", "beta"])
        chunks = chunk_note(note)
        assert len(chunks) == 1
        et = chunks[0].embed_text
        assert "tags: alpha, beta" in et
        assert "title: Test Note" in et
        assert "## Intro" in et
        assert "Hello world" in et

    def test_empty_body(self):
        note = _make_note("")
        chunks = chunk_note(note)
        assert len(chunks) == 1
        assert chunks[0].body == ""

    def test_h3_headers_not_split(self):
        body = "## Main\n\nContent.\n\n### Sub\n\nSub content."
        note = _make_note(body)
        chunks = chunk_note(note)
        # Only ## splits, ### stays within the parent chunk
        assert len(chunks) == 1
        assert "### Sub" in chunks[0].body

    def test_note_metadata_propagated(self):
        note = _make_note("## Section\n\nText.", type="project", tags=["x"])
        chunks = chunk_note(note)
        assert chunks[0].note_type == "project"
        assert chunks[0].tags == ["x"]
        assert chunks[0].note_title == "Test Note"

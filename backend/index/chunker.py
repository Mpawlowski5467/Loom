"""Markdown chunker: split notes into sections by ## headers for embedding."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from core.notes import Note, parse_note

if TYPE_CHECKING:
    from pathlib import Path

_SECTION_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)


@dataclass
class Chunk:
    """A single embeddable section of a note."""

    note_id: str
    note_title: str
    note_type: str
    tags: list[str]
    heading: str
    body: str
    chunk_index: int
    embed_text: str = field(init=False)

    def __post_init__(self) -> None:
        """Build the text that will be sent to the embedding model.

        Prepends tags and title to the section body so they influence
        the vector representation (frontmatter hybrid approach).
        """
        parts: list[str] = []
        if self.tags:
            parts.append(f"tags: {', '.join(self.tags)}")
        if self.note_title:
            parts.append(f"title: {self.note_title}")
        if self.heading:
            parts.append(f"## {self.heading}")
        parts.append(self.body.strip())
        self.embed_text = "\n".join(parts)


def chunk_note(note: Note) -> list[Chunk]:
    """Split a parsed note into chunks by ``##`` headers.

    If the note contains no ``##`` headers the entire body is returned
    as a single chunk with an empty heading.
    """
    body = note.body
    splits = list(_SECTION_RE.finditer(body))

    if not splits:
        return [
            Chunk(
                note_id=note.id,
                note_title=note.title,
                note_type=note.type,
                tags=list(note.tags),
                heading="",
                body=body.strip(),
                chunk_index=0,
            ),
        ]

    chunks: list[Chunk] = []

    # Content before the first ## header (preamble)
    preamble = body[: splits[0].start()].strip()
    if preamble:
        chunks.append(
            Chunk(
                note_id=note.id,
                note_title=note.title,
                note_type=note.type,
                tags=list(note.tags),
                heading="",
                body=preamble,
                chunk_index=0,
            ),
        )

    for i, match in enumerate(splits):
        heading = match.group(1).strip()
        start = match.end()
        end = splits[i + 1].start() if i + 1 < len(splits) else len(body)
        section_body = body[start:end].strip()

        chunks.append(
            Chunk(
                note_id=note.id,
                note_title=note.title,
                note_type=note.type,
                tags=list(note.tags),
                heading=heading,
                body=section_body,
                chunk_index=len(chunks),
            ),
        )

    return chunks


def chunk_file(path: Path) -> list[Chunk]:
    """Parse a markdown file and return its chunks."""
    note = parse_note(path)
    if not note.id:
        return []
    return chunk_note(note)

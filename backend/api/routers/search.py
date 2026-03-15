"""Keyword search API route."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from core.note_index import NoteIndex, get_note_index
from core.notes import parse_note

router = APIRouter(prefix="/api/search", tags=["search"])

MAX_RESULTS = 20
SNIPPET_LEN = 150


class SearchResult(BaseModel):
    """A single search hit."""

    id: str
    title: str
    type: str
    tags: list[str] = Field(default_factory=list)
    snippet: str = ""
    score: int = 0


class SearchResponse(BaseModel):
    """Response for keyword search."""

    query: str
    results: list[SearchResult]


def _snippet(body: str, query: str) -> str:
    """Extract a snippet around the first occurrence of query in body."""
    lower = body.lower()
    idx = lower.find(query.lower())
    if idx == -1:
        # Return beginning of body as fallback
        return body[:SNIPPET_LEN].strip()
    start = max(0, idx - 40)
    end = min(len(body), idx + SNIPPET_LEN - 40)
    text = body[start:end].strip()
    if start > 0:
        text = "..." + text
    if end < len(body):
        text = text + "..."
    return text


@router.get("")
def search_notes(
    q: str = Query(..., min_length=1, description="Search query"),
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> SearchResponse:
    """Search notes by keyword across title, tags, and body.

    Uses the in-memory index for title/tag matching. Only reads note
    bodies from disk when needed for body-text search and snippets.
    """
    query_lower = q.lower()
    scored: list[SearchResult] = []

    for entry in index.all_entries():
        score = 0
        body_text: str | None = None

        # Title match (highest weight)
        if query_lower in entry.title.lower():
            score += 10
            if entry.title.lower() == query_lower:
                score += 5

        # Tag match
        for tag in entry.tags:
            if query_lower in tag.lower():
                score += 5

        # Body match — only read from disk if title/tag didn't match,
        # or always read for snippet extraction if we already have a hit
        if entry.file_path.exists():
            try:
                note = parse_note(entry.file_path)
                body_text = note.body
            except Exception:  # noqa: BLE001
                body_text = None

        if body_text and query_lower in body_text.lower():
            score += 2
            count = body_text.lower().count(query_lower)
            score += min(count, 3)

        if score == 0:
            continue

        snippet = _snippet(body_text, q) if body_text else ""

        scored.append(SearchResult(
            id=entry.id,
            title=entry.title,
            type=entry.type,
            tags=entry.tags,
            snippet=snippet,
            score=score,
        ))

    # Sort by score descending, then title alphabetically
    scored.sort(key=lambda r: (-r.score, r.title.lower()))

    return SearchResponse(query=q, results=scored[:MAX_RESULTS])

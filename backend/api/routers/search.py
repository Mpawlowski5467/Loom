"""Keyword search API route."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from core.notes import parse_note
from core.vault import VaultManager, get_vault_manager

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
async def search_notes(
    q: str = Query(..., min_length=1, description="Search query"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> SearchResponse:
    """Search notes by keyword across title, tags, and body."""
    tdir = vm.active_threads_dir()
    if not tdir.exists():
        return SearchResponse(query=q, results=[])

    query_lower = q.lower()
    scored: list[SearchResult] = []

    for md in tdir.rglob("*.md"):
        if ".archive" in md.parts:
            continue
        try:
            note = parse_note(md)
        except Exception:  # noqa: BLE001
            continue

        if not note.id:
            continue

        score = 0

        # Title match (highest weight)
        if query_lower in note.title.lower():
            score += 10
            # Exact title match bonus
            if note.title.lower() == query_lower:
                score += 5

        # Tag match
        for tag in note.tags:
            if query_lower in tag.lower():
                score += 5

        # Body match
        if query_lower in note.body.lower():
            score += 2
            # Count occurrences for density bonus (capped)
            count = note.body.lower().count(query_lower)
            score += min(count, 3)

        if score == 0:
            continue

        scored.append(SearchResult(
            id=note.id,
            title=note.title,
            type=note.type,
            tags=note.tags,
            snippet=_snippet(note.body, q),
            score=score,
        ))

    # Sort by score descending, then title alphabetically
    scored.sort(key=lambda r: (-r.score, r.title.lower()))

    return SearchResponse(query=q, results=scored[:MAX_RESULTS])

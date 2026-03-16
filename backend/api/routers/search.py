"""Search API route: semantic search with keyword fallback."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from core.note_index import NoteIndex, get_note_index
from core.notes import parse_note
from index.searcher import get_searcher

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
    score: float = 0
    heading: str = ""


class SearchResponse(BaseModel):
    """Response for search queries."""

    query: str
    results: list[SearchResult]
    mode: str = "keyword"  # "semantic" or "keyword"


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


def _keyword_search(
    query: str,
    index: NoteIndex,
    type_filter: str | None = None,
    tag_filter: list[str] | None = None,
) -> list[SearchResult]:
    """Original keyword search as fallback when vector index is unavailable."""
    query_lower = query.lower()
    scored: list[SearchResult] = []

    for entry in index.all_entries():
        score = 0
        body_text: str | None = None

        # Apply type filter early
        if type_filter and entry.type != type_filter:
            continue

        # Apply tag filter early
        if tag_filter and not all(t in entry.tags for t in tag_filter):
            continue

        # Title match (highest weight)
        if query_lower in entry.title.lower():
            score += 10
            if entry.title.lower() == query_lower:
                score += 5

        # Tag match
        for tag in entry.tags:
            if query_lower in tag.lower():
                score += 5

        # Body match
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

        snippet = _snippet(body_text, query) if body_text else ""

        scored.append(
            SearchResult(
                id=entry.id,
                title=entry.title,
                type=entry.type,
                tags=entry.tags,
                snippet=snippet,
                score=score,
            )
        )

    scored.sort(key=lambda r: (-r.score, r.title.lower()))
    return scored[:MAX_RESULTS]


@router.get("")
async def search_notes(
    q: str = Query(..., min_length=1, description="Search query"),
    note_type: str | None = Query(None, alias="type", description="Filter by note type"),
    tags: str | None = Query(None, description="Filter by tags (comma-separated)"),
    context: str | None = Query(None, description="Context note ID for graph-aware boosting"),
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> SearchResponse:
    """Search notes using semantic search (if indexed) or keyword fallback.

    Query params:
        q: Search query string (required).
        type: Filter results by note type (e.g. 'topic', 'project').
        tags: Comma-separated tag filter (all must match).
        context: Note ID — results linked to this note get a score boost.
    """
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    # Try semantic search first
    searcher = get_searcher()
    if searcher is not None:
        try:
            filters: dict = {}
            if note_type:
                filters["type"] = note_type
            if tag_list:
                filters["tags"] = tag_list

            context_ids = [context] if context else None

            semantic_results = await searcher.search(
                q,
                filters=filters,
                context_note_ids=context_ids,
                limit=MAX_RESULTS,
            )

            if semantic_results:
                # Enrich with note titles from the in-memory index
                results: list[SearchResult] = []
                for sr in semantic_results:
                    entry = index.get_by_id(sr.note_id)
                    title = entry.title if entry else sr.note_id
                    results.append(
                        SearchResult(
                            id=sr.note_id,
                            title=title,
                            type=sr.note_type,
                            tags=sr.tags,
                            snippet=sr.snippet,
                            score=sr.score,
                            heading=sr.heading,
                        )
                    )
                return SearchResponse(query=q, results=results, mode="semantic")
        except Exception:  # noqa: BLE001
            pass  # Fall through to keyword search

    # Keyword fallback
    keyword_results = _keyword_search(q, index, type_filter=note_type, tag_filter=tag_list)
    return SearchResponse(query=q, results=keyword_results, mode="keyword")

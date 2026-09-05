"""Search API route: semantic search with keyword fallback."""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from core.exceptions import ProviderConfigError, ProviderError
from core.note_index import NoteIndex, get_note_index
from core.rate_limit import READ_LIMIT, limiter
from index.searcher import get_searcher

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])

MAX_RESULTS = 20
SNIPPET_LEN = 150
MAX_QUERY_LEN = 1000


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
    """Retrieve independent, filtered FTS candidates from the rebuildable index."""
    return [
        SearchResult(
            id=entry.id,
            title=entry.title,
            type=entry.type,
            tags=entry.tags,
            snippet=_snippet(entry.body, query),
            score=score,
        )
        for entry, score in index.lexical_search(query, type_filter, tag_filter, MAX_RESULTS * 4)
    ]


def _merge_search_results(
    query: str,
    keyword: list[SearchResult],
    semantic: list[Any],
    index: NoteIndex,
) -> list[SearchResult]:
    """Union lexical and vector candidates, then rank once at note level."""
    # Scores from keyword matching and vector distance have unrelated scales.
    # Reciprocal-rank fusion combines their order without pretending otherwise.
    fused: dict[str, float] = {}
    combined: dict[str, SearchResult] = {}
    rrf_k = 60
    for rank, result in enumerate(keyword, start=1):
        fused[result.id] = fused.get(result.id, 0) + 1 / (rrf_k + rank)
        combined[result.id] = result
    for rank, hit in enumerate(semantic, start=1):
        entry = index.get_by_id(hit.note_id)
        if entry is None:
            continue
        fused[hit.note_id] = fused.get(hit.note_id, 0) + 1 / (rrf_k + rank)
        previous = combined.get(hit.note_id)
        combined[hit.note_id] = SearchResult(
            id=hit.note_id,
            title=entry.title,
            type=hit.note_type,
            tags=hit.tags,
            snippet=hit.snippet or (previous.snippet if previous else ""),
            heading=hit.heading,
            score=0,
        )
    for note_id, result in combined.items():
        result.score = round(fused.get(note_id, 0), 6)
    exact = query.strip().lower()
    return sorted(
        combined.values(),
        key=lambda result: (result.title.lower() != exact, -result.score, result.title.lower()),
    )[:MAX_RESULTS]


@router.get("")
@limiter.limit(READ_LIMIT)
async def search_notes(
    request: Request,  # noqa: ARG001 — required by slowapi
    q: str = Query(..., min_length=1, max_length=MAX_QUERY_LEN, description="Search query"),
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

    # An exact title is deterministic, free, and more useful than waiting for
    # an embedding request. Keep filters in this fast path so it has the same
    # contract as hybrid retrieval.
    exact = q.strip().lower()
    exact_entries = [
        entry
        for entry in index.all_entries()
        if entry.title.lower() == exact
        and (note_type is None or entry.type == note_type)
        and (tag_list is None or all(tag in entry.tags for tag in tag_list))
    ]
    if exact_entries:
        return SearchResponse(
            query=q,
            results=[
                SearchResult(
                    id=entry.id,
                    title=entry.title,
                    type=entry.type,
                    tags=entry.tags,
                    score=100,
                )
                for entry in exact_entries
            ],
            mode="keyword",
        )

    # Lexical candidates are always collected first so exact title/body
    # matches are never discarded by a vector-only candidate cutoff.
    keyword_results = await asyncio.to_thread(
        _keyword_search, q, index, type_filter=note_type, tag_filter=tag_list
    )

    # Add vector candidates when available, then rank the union at note level.
    searcher = get_searcher()
    if searcher is not None:
        try:
            filters: dict[str, Any] = {}
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
                return SearchResponse(
                    query=q,
                    results=_merge_search_results(q, keyword_results, semantic_results, index),
                    mode="semantic",
                )
        except (ProviderError, ProviderConfigError, OSError):
            logger.warning("Semantic search failed, falling back to keyword", exc_info=True)

    # Keyword fallback
    return SearchResponse(query=q, results=keyword_results, mode="keyword")

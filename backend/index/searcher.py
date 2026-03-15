"""Hybrid search: vector similarity + keyword/tag filters + graph-aware boosting."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.graph import VaultGraph
    from core.providers import BaseProvider
    from index.indexer import VectorIndexer

logger = logging.getLogger(__name__)

GRAPH_BOOST_MULTIPLIER = 1.4
DEFAULT_LIMIT = 20


@dataclass
class SearchResult:
    """A single search hit returned to the caller."""

    note_id: str
    heading: str
    snippet: str
    score: float
    note_type: str
    tags: list[str] = field(default_factory=list)


class VectorSearcher:
    """Hybrid search over the LanceDB vector index."""

    def __init__(
        self,
        indexer: VectorIndexer,
        embed_provider: BaseProvider,
        graph: VaultGraph | None = None,
    ) -> None:
        self._indexer = indexer
        self._embed = embed_provider
        self._graph = graph

    def set_graph(self, graph: VaultGraph | None) -> None:
        """Update the cached graph (called after graph rebuilds)."""
        self._graph = graph

    async def search(
        self,
        query: str,
        *,
        filters: dict | None = None,
        context_note_ids: list[str] | None = None,
        limit: int = DEFAULT_LIMIT,
    ) -> list[SearchResult]:
        """Run hybrid search: vector + keyword/tag filters + graph boost.

        Args:
            query: Natural language search query.
            filters: Optional dict with ``type`` and/or ``tags`` keys.
            context_note_ids: Note IDs whose wikilink neighbours get boosted.
            limit: Max results to return.

        Returns:
            Ranked list of SearchResult objects.
        """
        if not self._indexer.is_ready:
            return []

        # Embed the query
        query_vec = await self._embed.embed(query)

        # Vector search — fetch more than limit so post-filters still yield enough
        fetch_k = limit * 4
        db = self._indexer._get_db()
        table = db.open_table("chunks")

        raw_results = table.search(query_vec).limit(fetch_k).to_list()

        if not raw_results:
            return []

        # Build set of linked note IDs for graph-aware boosting
        linked_ids = self._resolve_linked_ids(context_note_ids)

        # Post-process: filter, boost, deduplicate by note_id
        filters = filters or {}
        type_filter = filters.get("type")
        tag_filter = filters.get("tags")  # comma-separated string or list

        if isinstance(tag_filter, str):
            tag_filter = [t.strip() for t in tag_filter.split(",") if t.strip()]

        seen_notes: set[str] = set()
        results: list[SearchResult] = []

        for row in raw_results:
            note_id = row["note_id"]
            note_type = row["note_type"]
            tags = row.get("tags", []) or []

            # Apply type filter
            if type_filter and note_type != type_filter:
                continue

            # Apply tag filter (all requested tags must be present)
            if tag_filter and not all(t in tags for t in tag_filter):
                continue

            # Deduplicate: keep best chunk per note
            if note_id in seen_notes:
                continue
            seen_notes.add(note_id)

            # LanceDB returns _distance (L2) — convert to a similarity score
            distance = row.get("_distance", 0.0)
            score = 1.0 / (1.0 + distance)

            # Keyword boost: if query terms appear in the chunk text
            text_lower = (row.get("text") or "").lower()
            query_lower = query.lower()
            if query_lower in text_lower:
                score *= 1.2

            # Graph-aware boost
            if linked_ids and note_id in linked_ids:
                score *= GRAPH_BOOST_MULTIPLIER

            # Build snippet from chunk text (first 200 chars)
            raw_text = row.get("text") or ""
            snippet = self._make_snippet(raw_text, query)

            results.append(
                SearchResult(
                    note_id=note_id,
                    heading=row.get("heading") or "",
                    snippet=snippet,
                    score=round(score, 4),
                    note_type=note_type,
                    tags=list(tags),
                )
            )

        # Sort by score descending
        results.sort(key=lambda r: -r.score)
        return results[:limit]

    def _resolve_linked_ids(self, context_note_ids: list[str] | None) -> set[str]:
        """Return the set of note IDs linked to any context note."""
        if not context_note_ids or not self._graph:
            return set()

        context_set = set(context_note_ids)
        linked: set[str] = set()
        for edge in self._graph.edges:
            if edge.source in context_set:
                linked.add(edge.target)
            if edge.target in context_set:
                linked.add(edge.source)
        return linked

    @staticmethod
    def _make_snippet(text: str, query: str, length: int = 200) -> str:
        """Extract a snippet around the first match of query in text."""
        # Skip the prepended metadata lines (tags:, title:, ##)
        lines = text.split("\n")
        body_lines: list[str] = []
        for line in lines:
            if line.startswith("tags:") or line.startswith("title:") or line.startswith("##"):
                continue
            body_lines.append(line)
        body = "\n".join(body_lines).strip()

        if not body:
            body = text

        lower = body.lower()
        idx = lower.find(query.lower())
        if idx == -1:
            return body[:length].strip()

        start = max(0, idx - 40)
        end = min(len(body), idx + length - 40)
        snippet = body[start:end].strip()
        if start > 0:
            snippet = "..." + snippet
        if end < len(body):
            snippet = snippet + "..."
        return snippet


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_searcher: VectorSearcher | None = None


def get_searcher() -> VectorSearcher | None:
    """Return the global VectorSearcher, or None if not initialized."""
    return _searcher


def init_searcher(
    indexer: VectorIndexer,
    embed_provider: BaseProvider,
    graph: VaultGraph | None = None,
) -> VectorSearcher:
    """Create and cache the global VectorSearcher."""
    global _searcher
    _searcher = VectorSearcher(indexer, embed_provider, graph)
    return _searcher

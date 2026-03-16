"""Context pruning and relevance ranking for the Prompt Compiler.

Scores context items by keyword overlap with the query/template text,
drops items below a relevance threshold, and ranks the remainder with
the highest-scored items first (exploiting LLM recency bias by placing
the most relevant context closest to the end of the prompt).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from compiler.models import ContextItem

_WORD_RE = re.compile(r"[a-zA-Z0-9]+")

# Common English stop words to exclude from relevance scoring.
_STOP_WORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "from",
        "is",
        "it",
        "as",
        "be",
        "was",
        "are",
        "this",
        "that",
        "not",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "should",
        "could",
        "can",
        "may",
        "if",
        "then",
        "so",
        "no",
        "yes",
        "all",
        "any",
        "each",
        "every",
        "i",
        "you",
        "we",
        "he",
        "she",
        "they",
        "my",
        "your",
        "our",
        "its",
        "their",
    }
)


def _tokenize(text: str) -> set[str]:
    """Extract a set of lowercased words from text, excluding stop words.

    Args:
        text: Input text to tokenize.

    Returns:
        Set of unique lowercased words (stop words removed).
    """
    words = {w.lower() for w in _WORD_RE.findall(text)}
    return words - _STOP_WORDS


def score_relevance(item: ContextItem, query: str) -> float:
    """Score the relevance of a context item against a query string.

    Uses Jaccard-style overlap: the number of shared non-stop words
    divided by the total unique words in the query. Returns 0.0 if
    the query has no meaningful words.

    Args:
        item: The context item to score.
        query: The reference text (template or task description).

    Returns:
        A float between 0.0 and 1.0 indicating relevance.
    """
    query_words = _tokenize(query)
    if not query_words:
        return 0.0
    item_words = _tokenize(item.content)
    overlap = query_words & item_words
    return len(overlap) / len(query_words)


def prune_and_rank(
    items: list[ContextItem],
    query: str,
    threshold: float = 0.1,
) -> list[ContextItem]:
    """Prune low-relevance items and rank the rest by score.

    Each item is scored against the query. Items below the threshold
    are discarded. Remaining items are sorted by relevance descending
    (highest-scored first).

    Args:
        items: List of context items to evaluate.
        query: The reference text for relevance scoring.
        threshold: Minimum relevance score to keep an item (default 0.1).

    Returns:
        A new list of scored and filtered ``ContextItem`` instances,
        sorted by relevance descending.
    """
    scored: list[ContextItem] = []
    for item in items:
        relevance = score_relevance(item, query)
        scored_item = item.model_copy(update={"relevance": relevance})
        if relevance >= threshold:
            scored.append(scored_item)

    scored.sort(key=lambda ci: ci.relevance, reverse=True)
    return scored

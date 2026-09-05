"""Deterministic evidence for capture-review duplicate suggestions.

This module deliberately does not use a provider. Review affordances must be
explainable even when the configured model is unavailable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_TOKEN_RE = re.compile(r"[\w'-]+", re.UNICODE)


@dataclass(frozen=True)
class DuplicateEvidence:
    """One candidate and the text overlap that made it review-worthy."""

    note_id: str
    title: str
    score: float
    title_overlap: tuple[str, ...]
    body_overlap: tuple[str, ...]

    @property
    def rationale(self) -> str:
        """Return an honest, deterministic explanation for the suggestion."""
        terms = self.title_overlap or self.body_overlap
        if not terms:
            return "Similar wording in the title and body."
        return f"Shared terms: {', '.join(terms[:5])}."


def _tokens(value: str) -> set[str]:
    return {token.lower() for token in _TOKEN_RE.findall(value) if len(token) > 2}


def duplicate_evidence(
    *,
    capture_title: str,
    capture_body: str,
    notes: list[tuple[str, str, str]],
    limit: int = 5,
    minimum_score: float = 0.16,
) -> list[DuplicateEvidence]:
    """Rank notes by title/body token overlap without inventing a rationale.

    ``notes`` contains ``(id, title, body)`` tuples so the function stays
    independent of vault parsing and is straightforward to test.
    """
    capture_title_tokens = _tokens(capture_title)
    capture_body_tokens = _tokens(capture_body)
    capture_all = capture_title_tokens | capture_body_tokens
    if not capture_all:
        return []

    candidates: list[DuplicateEvidence] = []
    for note_id, title, body in notes:
        title_overlap = capture_title_tokens & _tokens(title)
        body_overlap = capture_body_tokens & _tokens(body)
        overlap = title_overlap | body_overlap
        note_all = _tokens(title) | _tokens(body)
        if not note_all:
            continue
        # Title matches carry more review value than coincidental long-body
        # overlap, while the Jaccard term prevents a giant note dominating.
        score = min(
            1.0,
            (len(overlap) / len(capture_all)) * 0.7
            + (len(title_overlap) / max(1, len(capture_title_tokens))) * 0.3,
        )
        if score < minimum_score:
            continue
        candidates.append(
            DuplicateEvidence(
                note_id=note_id,
                title=title,
                score=round(score, 3),
                title_overlap=tuple(sorted(title_overlap)),
                body_overlap=tuple(sorted(body_overlap)),
            )
        )
    return sorted(candidates, key=lambda item: (-item.score, item.title.lower()))[:limit]

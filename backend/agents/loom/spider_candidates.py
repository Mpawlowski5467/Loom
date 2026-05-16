"""Spider helper: candidate discovery and scoring.

Two paths: vector search (preferred when the embed provider + index are
available) and a fallback that uses the chat provider or a pure tag-overlap
heuristic. All paths produce a normalized list of LinkCandidate.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from agents.loom.spider_lookup import list_vault_notes, resolve_id, resolve_title
from agents.loom.spider_models import (
    AUTO_LINK_THRESHOLD,
    MAX_CANDIDATES,
    SUGGEST_THRESHOLD,
    LinkCandidate,
)
from agents.loom.spider_models import FIND_CONNECTIONS_SYSTEM as _FIND_CONNECTIONS_SYSTEM
from core.exceptions import ProviderConfigError, ProviderError
from core.notes import Note

if TYPE_CHECKING:
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)


def score_decision(score: float, _title: str) -> tuple[str, str]:
    """Map a confidence score to a linking decision."""
    if score >= AUTO_LINK_THRESHOLD:
        return "auto-linked", f"High confidence ({score:.2f}) — auto-linked"
    if score >= SUGGEST_THRESHOLD:
        return "suggested", f"Medium confidence ({score:.2f}) — suggested for review"
    return "skipped", f"Low confidence ({score:.2f}) — below threshold"


async def find_candidates(
    vault_root: Path,
    note: Note,
    existing_links: set[str],
    chat_provider: BaseProvider | None,
) -> list[LinkCandidate]:
    """Find and score candidate links using vector search or fallback."""
    candidates = await _find_candidates_vector(vault_root, note, existing_links)
    if not candidates:
        candidates = await _find_candidates_fallback(
            vault_root, note, existing_links, chat_provider
        )
    return candidates


async def _find_candidates_vector(
    vault_root: Path, note: Note, existing_links: set[str]
) -> list[LinkCandidate]:
    """Use vector search to find semantically similar notes."""
    from index.searcher import get_searcher

    searcher = get_searcher()
    if searcher is None:
        return []

    query = f"{note.title} {' '.join(note.tags)} {note.body[:500]}"

    try:
        results = await searcher.search(
            query,
            context_note_ids=[note.id],
            limit=MAX_CANDIDATES * 2,
        )
    except (ProviderError, ProviderConfigError, OSError):
        logger.warning("Vector search failed for Spider", exc_info=True)
        return []

    candidates: list[LinkCandidate] = []
    for result in results:
        if result.note_id == note.id:
            continue

        title = resolve_title(vault_root, result.note_id)
        if not title:
            continue

        if title.lower() in existing_links:
            continue

        decision, reason = score_decision(result.score, title)
        candidates.append(
            LinkCandidate(
                note_id=result.note_id,
                title=title,
                score=result.score,
                decision=decision,
                reason=reason,
            )
        )

        if len(candidates) >= MAX_CANDIDATES:
            break

    return candidates


async def _find_candidates_fallback(
    vault_root: Path,
    note: Note,
    existing_links: set[str],
    chat_provider: BaseProvider | None,
) -> list[LinkCandidate]:
    """Fall back to LLM or heuristic tag-overlap matching."""
    threads_dir = vault_root / "threads"
    vault_notes = list_vault_notes(threads_dir, exclude_id=note.id)

    if not vault_notes:
        return []

    if chat_provider is not None:
        titles = await _find_connections_llm(note, vault_notes, chat_provider)
    else:
        titles = _find_connections_heuristic(note, vault_notes)

    candidates: list[LinkCandidate] = []
    for i, title in enumerate(titles):
        if title.lower() in existing_links:
            continue

        score = max(0.85 - (i * 0.05), 0.4)
        decision, reason = score_decision(score, title)
        note_id = resolve_id(title, vault_notes)

        candidates.append(
            LinkCandidate(
                note_id=note_id,
                title=title,
                score=score,
                decision=decision,
                reason=reason,
            )
        )

    return candidates


async def _find_connections_llm(
    note: Note, vault_notes: list[dict[str, Any]], chat_provider: BaseProvider
) -> list[str]:
    """Use LLM to find meaningful connections."""
    note_list = "\n".join(
        f"- {n['title']} (tags: {', '.join(n['tags'])})" for n in vault_notes[:50]
    )
    user_msg = (
        f"Source note:\nTitle: {note.title}\nType: {note.type}\n"
        f"Tags: {', '.join(note.tags)}\nContent preview: {note.body[:1500]}\n\n"
        f"Vault notes:\n{note_list}\n\n"
        f"Which notes should be linked to the source? (max {MAX_CANDIDATES})"
    )

    try:
        resp = await chat_provider.chat(
            messages=[{"role": "user", "content": user_msg}],
            system=_FIND_CONNECTIONS_SYSTEM,
        )
        if "NONE" in resp.upper():
            return []
        titles = [line.strip() for line in resp.strip().splitlines() if line.strip()]
        valid = {n["title"].lower(): n["title"] for n in vault_notes}
        return [valid[t.lower()] for t in titles[:MAX_CANDIDATES] if t.lower() in valid]
    except (ProviderError, ProviderConfigError):
        logger.warning("LLM connection finding failed, using heuristic", exc_info=True)
        return _find_connections_heuristic(note, vault_notes)


def _find_connections_heuristic(note: Note, vault_notes: list[dict[str, Any]]) -> list[str]:
    """Find connections by tag overlap."""
    if not note.tags:
        return []

    note_tags = {t.lower() for t in note.tags}
    scored: list[tuple[int, str]] = []

    for vn in vault_notes:
        overlap = len(note_tags & {t.lower() for t in vn["tags"]})
        if overlap > 0:
            scored.append((overlap, vn["title"]))

    scored.sort(key=lambda x: -x[0])
    return [title for _, title in scored[:MAX_CANDIDATES]]

"""Weaver helper: LLM-driven classification and content generation."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from agents.loom.schema_sections import expected_sections
from agents.loom.weaver_helpers import parse_classification
from agents.loom.weaver_prompts import (
    CLASSIFY_SYSTEM,
    CREATE_SYSTEM,
    FORMAT_SYSTEM,
)
from agents.sanitize import scrub_untrusted
from core.exceptions import ProviderConfigError, ProviderError
from core.tokens import truncate_to_tokens

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

# Token budgets for source content embedded in prompts. These replace the old
# character slices (3000/4000 chars) with token-accurate caps so a dense note
# can't silently blow the context window.
_CLASSIFY_CONTENT_TOKENS = 1500
_BODY_CONTENT_TOKENS = 2000


def _required_headings(vault_root: Path, note_type: str) -> str:
    """Return required ## headings as a numbered directive list.

    Section truth comes from ``agents.loom.schema_sections`` — the same
    source Sentinel enforces and Weaver's skeletons use — so the prompt can
    never ask for sections the validator doesn't expect. Unknown types yield
    an empty string (the prompt then carries no heading directive).
    """
    headings = expected_sections(vault_root, note_type)
    if not headings:
        return ""
    return "\n".join(f"{i + 1}. ## {h}" for i, h in enumerate(headings))


async def classify_capture(content: str, chat_provider: BaseProvider | None) -> dict[str, str]:
    """Use LLM to classify a capture's type, folder, title, and tags."""
    if chat_provider is None:
        return classify_heuristic(content)

    user_message = (
        f"Classify this capture:\n\n---\n"
        f"{scrub_untrusted(truncate_to_tokens(content, _CLASSIFY_CONTENT_TOKENS))}\n---\n\n"
        "Respond with type, folder, title, and tags."
    )

    try:
        response = await chat_provider.chat(
            messages=[{"role": "user", "content": user_message}],
            system=CLASSIFY_SYSTEM,
        )
        parsed = parse_classification(response)
        if parsed.get("type") and parsed.get("title"):
            return parsed
    except (ProviderError, ProviderConfigError):
        logger.warning("LLM classification failed, using heuristic", exc_info=True)

    return classify_heuristic(content)


def classify_heuristic(content: str) -> dict[str, str]:
    """Simple keyword-based fallback classification."""
    lower = content.lower()
    if any(kw in lower for kw in ("standup", "daily", "today", "morning", "afternoon")):
        return {"type": "daily", "folder": "daily", "title": "Daily Log", "tags": "daily"}
    if any(kw in lower for kw in ("project", "milestone", "sprint", "roadmap")):
        return {
            "type": "project",
            "folder": "projects",
            "title": "New Project",
            "tags": "project",
        }
    if any(kw in lower for kw in ("meeting with", "spoke to", "conversation with")):
        return {"type": "person", "folder": "people", "title": "Person Note", "tags": "person"}
    return {"type": "topic", "folder": "topics", "title": "New Topic", "tags": "topic"}


async def generate_note_body(
    vault_root: Path,
    raw_content: str,
    note_type: str,
    chat_provider: BaseProvider | None,
    chain: ReadChainResult | None = None,  # noqa: ARG001 — read for compliance, not injected
) -> str:
    """Use LLM to generate a structured note body from raw content."""
    if chat_provider is None:
        return raw_content

    headings = _required_headings(vault_root, note_type)

    user_message = (
        "Produce the markdown body for the new note.\n\n"
        f"Required ## headings — use these EXACT headings in this EXACT order, "
        f"and use NO other ## headings:\n{headings}\n\n"
        f"Source content:\n---\n"
        f"{scrub_untrusted(truncate_to_tokens(raw_content, _BODY_CONTENT_TOKENS))}\n---\n\n"
        "Return only the body. Start with the first `## ` heading. "
        "Every required heading must appear, even if its section is one line."
    )

    try:
        return await chat_provider.chat(
            messages=[{"role": "user", "content": user_message}],
            system=CREATE_SYSTEM,
        )
    except (ProviderError, ProviderConfigError):
        logger.warning("LLM note generation failed, using raw content", exc_info=True)
        return raw_content


async def format_content(
    vault_root: Path,
    content: str,
    note_type: str,
    chat_provider: BaseProvider | None,
) -> str:
    """Use LLM to format user-provided content per the type schema."""
    if chat_provider is None:
        return content

    headings = _required_headings(vault_root, note_type)
    user_message = (
        "Format this user content into the required note structure.\n\n"
        f"Required ## headings — use these EXACT headings in this EXACT order, "
        f"and use NO other ## headings:\n{headings}\n\n"
        f"User content:\n---\n"
        f"{scrub_untrusted(truncate_to_tokens(content, _BODY_CONTENT_TOKENS))}\n---\n\n"
        "Return only the body. Start with the first `## ` heading. "
        "Every required heading must appear, even if its section is one line."
    )

    try:
        return await chat_provider.chat(
            messages=[{"role": "user", "content": user_message}],
            system=FORMAT_SYSTEM,
        )
    except (ProviderError, ProviderConfigError):
        logger.warning("LLM formatting failed, using raw content", exc_info=True)
        return content

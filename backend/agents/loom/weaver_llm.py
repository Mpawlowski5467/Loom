"""Weaver helper: bounded LLM classification and content generation."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from agents.loom.schema_sections import expected_sections
from agents.loom.weaver_helpers import parse_classification
from agents.loom.weaver_prompts import CLASSIFY_SYSTEM, CREATE_SYSTEM, FORMAT_SYSTEM
from agents.loom.weaver_source import (
    MAX_SOURCE_TOKENS,
    ClassificationResult,
    GeneratedBody,
    SourceChunk,
    SourceCoverage,
    coverage_for,
    merge_bodies,
    merge_classifications,
    prompt_source,
)
from agents.loom.weaver_source import (
    SourceTooLargeError as _SourceTooLargeError,
)
from agents.loom.weaver_source import (
    chunk_source as _chunk_source,
)
from core.exceptions import ProviderConfigError, ProviderError

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)
SourceTooLargeError = _SourceTooLargeError

# Token budgets for each source chunk embedded in prompts. Sources are chunked
# losslessly up to the safety limit; they are never silently sliced.
_CLASSIFY_CONTENT_TOKENS = 1500
_BODY_CONTENT_TOKENS = 2000
_MAX_SOURCE_TOKENS = MAX_SOURCE_TOKENS


def chunk_source(
    content: str,
    chunk_tokens: int,
    *,
    source_link: str = "",
) -> tuple[SourceChunk, ...]:
    """Split source losslessly into bounded provider chunks."""
    return _chunk_source(
        content,
        chunk_tokens,
        source_link=source_link,
        max_source_tokens=_MAX_SOURCE_TOKENS,
    )


def _required_headings(vault_root: Path, note_type: str) -> str:
    """Return required ## headings as a numbered directive list."""
    headings = expected_sections(vault_root, note_type)
    if not headings:
        return ""
    return "\n".join(f"{i + 1}. ## {heading}" for i, heading in enumerate(headings))


async def classify_capture(
    content: str,
    chat_provider: BaseProvider | None,
    *,
    source_link: str = "",
) -> dict[str, str]:
    """Classify a capture while covering every bounded source chunk."""
    chunks = chunk_source(content, _CLASSIFY_CONTENT_TOKENS, source_link=source_link)
    coverage = coverage_for(chunks, source_link)
    if chat_provider is None:
        return ClassificationResult(classify_heuristic(content), coverage)

    parsed_values: list[dict[str, str]] = []
    try:
        for chunk in chunks:
            response = await chat_provider.chat(
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Classify this capture chunk:\n\n---\n"
                            f"{prompt_source(chunk, coverage)}\n---\n\n"
                            "Respond with type, folder, title, and tags."
                        ),
                    }
                ],
                system=CLASSIFY_SYSTEM,
            )
            parsed = parse_classification(response)
            if parsed.get("type") and parsed.get("title"):
                parsed_values.append(parsed)
        merged = merge_classifications(parsed_values, coverage)
        if merged.get("type") and merged.get("title"):
            return merged
    except (ProviderError, ProviderConfigError):
        logger.warning("LLM classification failed, using heuristic", exc_info=True)
    return ClassificationResult(classify_heuristic(content), coverage)


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


async def _generate_chunks(
    chunks: tuple[SourceChunk, ...],
    coverage: SourceCoverage,
    headings: str,
    system: str,
    provider: BaseProvider,
    label: str,
    source_name: str,
) -> list[str]:
    """Generate one structured response per source chunk."""
    outputs: list[str] = []
    for chunk in chunks:
        outputs.append(
            await provider.chat(
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"{label} chunk into the required note structure.\n\n"
                            "Required ## headings — use these EXACT headings in this EXACT order, "
                            f"and use NO other ## headings:\n{headings}\n\n"
                            f"{source_name}\n---\n{prompt_source(chunk, coverage)}\n---\n\n"
                            "Return only the body. Start with the first `## ` heading. "
                            "Every required heading must appear, even if its section is one line."
                        ),
                    }
                ],
                system=system,
            )
        )
    return outputs


async def generate_note_body(
    vault_root: Path,
    raw_content: str,
    note_type: str,
    chat_provider: BaseProvider | None,
    chain: ReadChainResult | None = None,  # noqa: ARG001 — read for compliance, not injected
    *,
    source_link: str = "",
) -> str:
    """Generate a structured body while covering every source chunk."""
    chunks = chunk_source(raw_content, _BODY_CONTENT_TOKENS, source_link=source_link)
    coverage = coverage_for(chunks, source_link)
    if chat_provider is None:
        return GeneratedBody(raw_content, coverage)

    headings = _required_headings(vault_root, note_type)
    try:
        outputs = await _generate_chunks(
            chunks,
            coverage,
            headings,
            CREATE_SYSTEM,
            chat_provider,
            "Produce the markdown body for this capture",
            "Source content:",
        )
        return GeneratedBody(merge_bodies(outputs, headings), coverage)
    except (ProviderError, ProviderConfigError):
        logger.warning("LLM note generation failed, using raw content", exc_info=True)
        return GeneratedBody(raw_content, coverage)


async def format_content(
    vault_root: Path,
    content: str,
    note_type: str,
    chat_provider: BaseProvider | None,
    *,
    source_link: str = "",
) -> str:
    """Format user content in bounded chunks without dropping its tail."""
    chunks = chunk_source(content, _BODY_CONTENT_TOKENS, source_link=source_link)
    coverage = coverage_for(chunks, source_link)
    if chat_provider is None:
        return GeneratedBody(content, coverage)

    headings = _required_headings(vault_root, note_type)
    try:
        outputs = await _generate_chunks(
            chunks,
            coverage,
            headings,
            FORMAT_SYSTEM,
            chat_provider,
            "Format this user content",
            "User content:",
        )
        return GeneratedBody(merge_bodies(outputs, headings), coverage)
    except (ProviderError, ProviderConfigError):
        logger.warning("LLM formatting failed, using raw content", exc_info=True)
        return GeneratedBody(content, coverage)

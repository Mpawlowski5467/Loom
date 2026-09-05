"""Lossless, bounded source handling for Weaver provider prompts."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from agents.sanitize import scrub_untrusted
from core.tokens import count_tokens

MAX_SOURCE_TOKENS = 12_000


@dataclass(frozen=True, slots=True)
class SourceCoverage:
    """Evidence that a prompt covered the complete capture source."""

    source_tokens: int
    covered_tokens: int
    chunk_count: int
    complete: bool
    source_link: str = ""
    omitted_reason: str = ""

    @property
    def omitted_tokens(self) -> int:
        """Return the number of source tokens omitted from model context."""
        return max(self.source_tokens - self.covered_tokens, 0)

    def to_dict(self) -> dict[str, int | bool | str]:
        """Return JSON-safe coverage metadata for capture responses."""
        return {
            "source_tokens": self.source_tokens,
            "covered_tokens": self.covered_tokens,
            "omitted_tokens": self.omitted_tokens,
            "chunk_count": self.chunk_count,
            "complete": self.complete,
            "source_link": self.source_link,
            "omitted_reason": self.omitted_reason,
        }


class SourceTooLargeError(ValueError):
    """Raised when a capture exceeds the bounded extraction safety limit."""

    def __init__(self, coverage: SourceCoverage) -> None:
        self.coverage = coverage
        super().__init__(
            "Capture source exceeds the extraction limit: "
            f"{coverage.source_tokens} tokens; review required"
        )


@dataclass(frozen=True, slots=True)
class SourceChunk:
    """A lossless, bounded source segment sent to a provider."""

    index: int
    total: int
    start_token: int
    end_token: int
    text: str


class ClassificationResult(dict[str, str]):
    """Backward-compatible classification mapping with source coverage."""

    coverage: SourceCoverage

    def __init__(self, values: dict[str, str], coverage: SourceCoverage) -> None:
        super().__init__(values)
        self.coverage = coverage


class GeneratedBody(str):
    """Backward-compatible body string with source coverage metadata."""

    coverage: SourceCoverage

    def __new__(cls, value: str, coverage: SourceCoverage) -> GeneratedBody:
        result = super().__new__(cls, value)
        result.coverage = coverage
        return result


def _split_oversize_line(text: str, max_tokens: int) -> list[str]:
    """Split one long line at a token boundary without dropping characters."""
    parts: list[str] = []
    remaining = text
    while remaining:
        if count_tokens(remaining) <= max_tokens:
            parts.append(remaining)
            break
        low, high = 1, len(remaining)
        while low < high:
            middle = (low + high + 1) // 2
            if count_tokens(remaining[:middle]) <= max_tokens:
                low = middle
            else:
                high = middle - 1
        parts.append(remaining[:low])
        remaining = remaining[low:]
    return parts


def chunk_source(
    content: str,
    chunk_tokens: int,
    *,
    source_link: str = "",
    max_source_tokens: int = MAX_SOURCE_TOKENS,
) -> tuple[SourceChunk, ...]:
    """Split source losslessly into bounded chunks for provider calls.

    Raises:
        SourceTooLargeError: If the complete source exceeds the safety limit.
    """
    source_tokens = count_tokens(content)
    if source_tokens > max_source_tokens:
        raise SourceTooLargeError(
            SourceCoverage(
                source_tokens=source_tokens,
                covered_tokens=0,
                chunk_count=0,
                complete=False,
                source_link=source_link,
                omitted_reason="source exceeds bounded extraction limit",
            )
        )
    if not content:
        return (SourceChunk(1, 1, 0, 0, ""),)

    pieces: list[str] = []
    current = ""
    for line in content.splitlines(keepends=True):
        if count_tokens(line) > chunk_tokens:
            if current:
                pieces.append(current)
                current = ""
            pieces.extend(_split_oversize_line(line, chunk_tokens))
        elif current and count_tokens(current + line) > chunk_tokens:
            pieces.append(current)
            current = line
        else:
            current += line
    if current:
        pieces.append(current)

    total = len(pieces)
    chunks: list[SourceChunk] = []
    start = 0
    for index, piece in enumerate(pieces, 1):
        size = count_tokens(piece)
        chunks.append(SourceChunk(index, total, start, start + size, piece))
        start += size
    return tuple(chunks)


def coverage_for(chunks: tuple[SourceChunk, ...], source_link: str) -> SourceCoverage:
    """Build complete coverage metadata for a chunk sequence."""
    source_tokens = sum(count_tokens(chunk.text) for chunk in chunks)
    return SourceCoverage(
        source_tokens=source_tokens,
        covered_tokens=source_tokens,
        chunk_count=len(chunks),
        complete=True,
        source_link=source_link,
    )


def prompt_source(chunk: SourceChunk, coverage: SourceCoverage) -> str:
    """Render explicit coverage metadata alongside one untrusted chunk."""
    source_link = f" Source link: {coverage.source_link}." if coverage.source_link else ""
    return (
        f"Source coverage: complete, chunk {chunk.index}/{chunk.total}, "
        f"tokens {chunk.start_token}-{chunk.end_token} of {coverage.source_tokens}."
        f"{source_link}\n"
        f"{scrub_untrusted(chunk.text)}"
    )


def merge_classifications(
    values: list[dict[str, str]], coverage: SourceCoverage
) -> ClassificationResult:
    """Merge per-chunk classifications without letting a tail disappear."""
    if not values:
        return ClassificationResult({}, coverage)
    merged: dict[str, str] = {}
    for key in ("type", "folder", "title"):
        candidates = [value[key] for value in values if value.get(key)]
        if candidates:
            merged[key] = Counter(candidates).most_common(1)[0][0]
    tags: list[str] = []
    for value in values:
        for tag in value.get("tags", "").split(","):
            clean = tag.strip()
            if clean and clean not in tags:
                tags.append(clean)
    if tags:
        merged["tags"] = ", ".join(tags)
    return ClassificationResult(merged, coverage)


_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def merge_bodies(outputs: list[str], headings: str) -> str:
    """Merge chunk outputs by heading while retaining every chunk's prose."""
    if len(outputs) == 1:
        return outputs[0]
    expected = [line.removeprefix("1. ## ").removeprefix("## ") for line in headings.splitlines()]
    expected = [re.sub(r"^\d+\.\s+##\s+", "", item).strip() for item in expected]
    sections: dict[str, list[str]] = {heading.lower(): [] for heading in expected}
    unheaded: list[str] = []
    for output in outputs:
        matches = list(_HEADING_RE.finditer(output))
        if not matches:
            unheaded.append(output.strip())
            continue
        for index, match in enumerate(matches):
            body = output[
                match.end() : matches[index + 1].start() if index + 1 < len(matches) else None
            ]
            key = match.group(1).strip().lower()
            sections.setdefault(key, []).append(body.strip())
    if not sections:
        return "\n\n".join(output.strip() for output in outputs if output.strip())
    if unheaded and expected:
        sections.setdefault(expected[0].lower(), []).extend(unheaded)
    rendered: list[str] = []
    for heading in expected:
        bodies = [body for body in sections.get(heading.lower(), []) if body]
        rendered.append(f"## {heading}\n\n{chr(10).join(bodies)}")
    return "\n\n".join(rendered)

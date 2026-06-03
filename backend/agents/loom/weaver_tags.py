"""Post-LLM tag validation for Weaver.

The classify-capture LLM call returns a free-form tag list. Models — small
local ones especially — sometimes produce close-but-wrong tags (e.g. the
``rafter`` typo for ``raft``). This module snaps generated tags to existing
vault vocabulary by **edit-distance heuristic**:

- Distance 1 from an existing tag (length > 3) → snapped. Catches the
  classic typos: one letter wrong, one inserted, one missing.
- Distance ≤ 2 from an existing tag, AND both tags are length ≥ 5 → also
  snapped. Catches multi-character drops like ``rafter`` → ``raft`` (2
  deletions) without firing on short tags where small distances are
  semantically meaningful.
- Otherwise the tag is kept as-is. New vocabulary is a feature, not a bug;
  we don't gate the LLM from introducing genuinely-novel tags.

Returned data is normalised to lowercase, kebab-friendly form. Empty
strings and very short tags (< 2 chars) are dropped.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

logger = logging.getLogger(__name__)

_MIN_TAG_LEN = 2  # Anything shorter than this is noise, not a tag.


def normalise_tag(tag: str) -> str:
    """Lowercase, strip whitespace, and collapse internal spaces to hyphens."""
    t = tag.strip().lower()
    # Collapse runs of whitespace to single hyphens but leave existing
    # hyphens / pluses (e.g. "tla+", "c++") intact.
    t = re.sub(r"\s+", "-", t)
    return t


def _levenshtein_le_1(a: str, b: str) -> bool:
    """Return True if the Levenshtein distance between a and b is ≤ 1.

    Fast-path version: handles only distance 0 (equal) and 1 (one
    substitution / insertion / deletion). Anything larger returns False.
    """
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False

    if la == lb:
        # One substitution.
        diffs = sum(1 for x, y in zip(a, b, strict=True) if x != y)
        return diffs == 1

    # One insertion / deletion. Walk both strings, allowing exactly one skip.
    short, long = (a, b) if la < lb else (b, a)
    i = j = 0
    skipped = False
    while i < len(short) and j < len(long):
        if short[i] != long[j]:
            if skipped:
                return False
            skipped = True
            j += 1
            continue
        i += 1
        j += 1
    return True


def _levenshtein_le_2(a: str, b: str) -> bool:
    """Return True if the Levenshtein distance is ≤ 2. Full DP, but tiny inputs."""
    la, lb = len(a), len(b)
    if abs(la - lb) > 2:
        return False
    if _levenshtein_le_1(a, b):
        return True
    # Classic two-row DP, capped at distance 2.
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        min_in_row = i
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if cur[j] < min_in_row:
                min_in_row = cur[j]
        if min_in_row > 2:
            return False
        prev = cur
    return prev[lb] <= 2


def snap_tags(
    raw_tags: Iterable[str],
    vault_tags: set[str],
    *,
    max_tags: int = 5,
) -> tuple[list[str], list[tuple[str, str]]]:
    """Validate / snap a list of LLM-generated tags.

    Args:
        raw_tags: Tags as returned by the classifier (any case, any spelling).
        vault_tags: Lowercased set of tags currently present in the vault.
        max_tags: Cap on the number of returned tags (matches prime.md rule).

    Returns:
        A pair ``(final_tags, snapped)`` where:
        - ``final_tags`` is the cleaned-up list to put on the note.
        - ``snapped`` is a list of ``(raw_tag, corrected_tag)`` pairs that
          were rewritten. Useful for logging / surfacing the correction.
    """
    final: list[str] = []
    snapped: list[tuple[str, str]] = []
    seen: set[str] = set()

    for raw in raw_tags:
        norm = normalise_tag(raw)
        if len(norm) < _MIN_TAG_LEN:
            continue

        # Existing tag → keep as-is.
        if norm in vault_tags:
            chosen = norm
        else:
            # Look for an edit-distance-1 neighbour in the vault.
            neighbour = _closest_edit_1(norm, vault_tags)
            if neighbour is not None:
                chosen = neighbour
                snapped.append((norm, neighbour))
                logger.info("Tag snapped: %r → %r", norm, neighbour)
            else:
                # Plausibly novel — keep it.
                chosen = norm

        if chosen not in seen:
            seen.add(chosen)
            final.append(chosen)
            if len(final) >= max_tags:
                break

    return final, snapped


def _closest_edit_1(needle: str, vault_tags: set[str]) -> str | None:
    """Return the closest vault tag to ``needle`` under the snap heuristic.

    Tier 1: distance ≤ 1 for tags > 3 chars. Catches typos like
    ``consensu`` → ``consensus``.

    Tier 2: distance ≤ 2 for tags ≥ 5 chars (on both sides). Catches
    multi-character drops like ``rafter`` → ``raft`` without firing on
    short tags where a distance-2 edit can be semantically meaningful.

    Returns None if no candidate matches either tier.
    """
    if len(needle) <= 3:
        return None

    # Tier 1: tight distance-1 match.
    for candidate in vault_tags:
        if abs(len(candidate) - len(needle)) > 1:
            continue
        if len(candidate) <= 3:
            continue
        if _levenshtein_le_1(needle, candidate):
            return candidate

    # Tier 2: looser distance-2 match, but only for longer tags.
    if len(needle) < 5:
        return None
    for candidate in vault_tags:
        if len(candidate) < 5:
            continue
        if abs(len(candidate) - len(needle)) > 2:
            continue
        if _levenshtein_le_2(needle, candidate):
            return candidate
    return None

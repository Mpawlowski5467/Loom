"""Sentinel verdict enforcement, shared by the pipeline graph and the live
capture endpoint.

Three outcomes mirror Sentinel's verdicts:
  passed  → archive the capture, ship the note clean
  warning → archive the capture, annotate the note as "flagged"
  failed  → keep the capture in the inbox marked review_required; the note
            exists but the user is warned to check it

Frontmatter annotation is best-effort: a failure is logged, never raised — the
user-visible flow (note created, capture maybe archived) matters more than the
annotation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class EnforcementOutcome:
    """What enforcement decided about a capture + its note."""

    capture_archived: bool = False
    review_required: bool = False
    flagged: bool = False


def enforce_verdict(
    vault_dir: Path,
    capture_path: Path,
    note_path: Path | None,
    verdict: str,
    reasons: list[str],
) -> EnforcementOutcome:
    """Apply Sentinel's verdict to the capture and note. See module docstring."""
    outcome = EnforcementOutcome()
    if verdict == "failed":
        outcome.review_required = True
        if note_path is not None:
            _annotate_frontmatter(note_path, {"review_required": True, "review_reasons": reasons})
        _annotate_frontmatter(capture_path, {"review_required": True, "review_reasons": reasons})
        return outcome

    # passed or warning (or no sentinel) → archive the capture.
    try:
        from agents.loom.weaver_io import archive_capture

        archive_capture(vault_dir, "weaver", capture_path)
        outcome.capture_archived = True
    except Exception:
        logger.warning("Capture archive failed", exc_info=True)
    if verdict == "warning":
        outcome.flagged = True
        if note_path is not None:
            _annotate_frontmatter(note_path, {"flagged": True, "flag_reasons": reasons})
    return outcome


def _annotate_frontmatter(path: Path, fields: dict) -> None:
    """Read a note, merge ``fields`` into frontmatter, write atomically."""
    try:
        from core.notes import atomic_write_text, build_frontmatter, parse_note

        note = parse_note(path)
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta.update(fields)
        atomic_write_text(path, build_frontmatter(meta) + "\n" + note.body)
    except Exception:
        logger.warning("Failed to annotate %s", path, exc_info=True)

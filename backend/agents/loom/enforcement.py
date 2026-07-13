"""Sentinel verdict enforcement, shared by the pipeline graph and the live
capture endpoint.

Three outcomes mirror Sentinel's verdicts:
  passed  → archive the capture, ship the note clean
  warning → archive the capture, annotate the note as "flagged"
  anything else (failed/unavailable/missing) → keep the capture in the inbox
            marked review_required; the note exists but the user is warned
            to check it

Frontmatter annotation is best-effort: a failure is logged, never raised — the
user-visible flow (note created, capture maybe archived) matters more than the
annotation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

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
    if verdict not in {"passed", "warning"}:
        if not reasons:
            reasons = ["Sentinel validation unavailable or incomplete"]
        outcome.review_required = True
        if note_path is not None:
            annotate_frontmatter(
                vault_dir, note_path, {"review_required": True, "review_reasons": reasons}
            )
        annotate_frontmatter(
            vault_dir, capture_path, {"review_required": True, "review_reasons": reasons}
        )
        return outcome

    # Only an explicit passed or warning verdict may archive the capture.
    try:
        from agents.loom.weaver_io import archive_capture

        archive_capture(vault_dir, "weaver", capture_path)
        outcome.capture_archived = True
    except Exception:
        logger.warning("Capture archive failed", exc_info=True)
    if verdict == "warning":
        outcome.flagged = True
        if note_path is not None:
            annotate_frontmatter(vault_dir, note_path, {"flagged": True, "flag_reasons": reasons})
    return outcome


def annotate_frontmatter(vault_dir: Path, path: Path, fields: dict[str, Any]) -> None:
    """Read a note, merge ``fields`` into frontmatter, write through ``vault_io``.

    Unknown user frontmatter keys are preserved (carried in ``Note.extra`` and
    re-emitted by ``build_frontmatter``). Best-effort: a failure is logged,
    never raised — annotation matters less than the user-visible note flow.
    """
    try:
        from core.notes import parse_note
        from core.vault_io import write_note

        note = parse_note(path)
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta.update(fields)
        write_note(vault_dir, path, meta, note.body)
    except Exception:
        logger.warning("Failed to annotate %s", path, exc_info=True)

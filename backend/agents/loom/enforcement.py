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


def _draft_reference(note_path: Path | None) -> dict[str, str]:
    """Return persistent draft identity for a capture that needs review."""
    if note_path is None:
        return {}
    try:
        from core.notes import parse_note_meta

        meta = parse_note_meta(note_path)
        return {
            "draft_note_id": meta.id,
            "draft_note_path": str(note_path),
        }
    except Exception:
        logger.warning("Failed to resolve draft note reference", exc_info=True)
        return {"draft_note_path": str(note_path)}


def enforce_verdict(
    vault_dir: Path,
    capture_path: Path,
    note_path: Path | None,
    verdict: str,
    reasons: list[str],
    validation_mode: str = "",
) -> EnforcementOutcome:
    """Apply Sentinel's verdict to the capture and note. See module docstring."""
    outcome = EnforcementOutcome()
    validation_status = verdict or "unavailable"
    if verdict not in {"passed", "warning"}:
        if not reasons:
            reasons = ["Sentinel validation unavailable or incomplete"]
        outcome.review_required = True
        fields = {
            "enforcement_outcome": "needs_review",
            "validation": validation_status,
            "validation_mode": validation_mode,
            "validation_reasons": reasons,
            "review_required": True,
            "review_reasons": reasons,
        }
        if note_path is not None:
            annotate_frontmatter(vault_dir, note_path, fields)
        capture_fields = {**fields, **_draft_reference(note_path)}
        annotate_frontmatter(vault_dir, capture_path, capture_fields)
        return outcome

    # Only an explicit passed or warning verdict may archive the capture.
    # Stamp the lifecycle verdict before the move so the archived source keeps
    # its provenance and the final enforcement decision for audit/replay.
    lifecycle_fields = {
        "enforcement_outcome": "filed",
        "validation": validation_status,
        "validation_mode": validation_mode,
        "validation_reasons": reasons,
        "review_required": False,
        "review_reasons": [],
        "flagged": verdict == "warning",
        "flag_reasons": reasons if verdict == "warning" else [],
    }
    annotate_frontmatter(vault_dir, capture_path, lifecycle_fields)
    note_fields = lifecycle_fields
    try:
        from agents.loom.weaver_io import archive_capture

        archive_capture(vault_dir, "weaver", capture_path)
        outcome.capture_archived = True
    except Exception:
        logger.warning("Capture archive failed", exc_info=True)
        # The draft may be valid, but the Inbox transaction did not finish.
        # Fail closed and leave durable state that tells the UI not to call it
        # filed merely because a note exists.
        archive_reasons = ["Capture could not be archived after validation"]
        outcome.review_required = True
        note_fields = {
            **lifecycle_fields,
            "enforcement_outcome": "needs_review",
            "review_required": True,
            "review_reasons": archive_reasons,
        }
        annotate_frontmatter(
            vault_dir,
            capture_path,
            {
                "enforcement_outcome": "needs_review",
                "review_required": True,
                "review_reasons": archive_reasons,
                **_draft_reference(note_path),
            },
        )
    if note_path is not None:
        # A retry may reuse a draft annotated by an earlier failed verdict.
        # Always stamp the current lifecycle state so stale review/validation
        # metadata cannot leak into a successfully filed note.
        annotate_frontmatter(vault_dir, note_path, note_fields)
    outcome.flagged = verdict == "warning"
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

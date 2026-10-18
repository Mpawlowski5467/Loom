"""Sentinel verdict enforcement, shared by the pipeline graph and the live
capture endpoint.

Three outcomes mirror Sentinel's verdicts:
  passed  → archive the capture, ship the note clean
  warning → archive the capture, annotate the note as "flagged"
  anything else (failed/unavailable/missing) → keep the capture in the inbox
            marked review_required; the note exists but the user is warned
            to check it

Most frontmatter annotation is best-effort. Publication annotation is the
exception: an accepted draft is not visible until its ``publication_state`` is
durably stamped. If that final write fails after its capture was archived, the
capture is restored byte-for-byte to Inbox and the run is marked reviewable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
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
    reasons: list[str] = field(default_factory=list)


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
    source_coverage: dict[str, Any] | None = None,
) -> EnforcementOutcome:
    """Apply Sentinel's verdict to the capture and note. See module docstring.

    ``source_coverage`` is stamped onto the capture with its lifecycle
    verdict, before any archive move: ``vault_io`` refuses writes under
    ``.archive/``, so the archived source can only carry it from here.
    """
    outcome = EnforcementOutcome()
    validation_status = verdict or "unavailable"
    coverage_fields = {"source_coverage": source_coverage} if source_coverage else {}
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
            "publication_state": "rejected",
        }
        if note_path is not None:
            annotate_frontmatter(vault_dir, note_path, fields)
        capture_fields = {**fields, **coverage_fields, **_draft_reference(note_path)}
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
    try:
        original_capture = capture_path.read_text(encoding="utf-8")
    except OSError:
        logger.warning("Could not snapshot capture before enforcement", exc_info=True)
        original_capture = ""
    annotate_frontmatter(vault_dir, capture_path, {**lifecycle_fields, **coverage_fields})
    note_fields = {**lifecycle_fields, "publication_state": "published"}
    archived_capture: Path | None = None
    try:
        from agents.loom.weaver_io import archive_capture

        archived_capture = archive_capture(vault_dir, "weaver", capture_path)
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
            "publication_state": "rejected",
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
        # metadata cannot leak into a successfully filed note. This final
        # annotation is the publication commit, so unlike noncritical fields
        # it must not silently fail after the source has moved to archive.
        try:
            annotate_frontmatter(
                vault_dir,
                note_path,
                note_fields,
                strict=archived_capture is not None,
            )
        except Exception:
            reason = "Publication could not be completed"
            outcome.capture_archived = False
            outcome.review_required = True
            outcome.flagged = False
            outcome.reasons.append(reason)
            logger.error("Publication annotation failed for %s", note_path, exc_info=True)
            if archived_capture is not None and original_capture:
                try:
                    _restore_archived_capture(
                        vault_dir,
                        capture_path,
                        archived_capture,
                        original_capture,
                    )
                    outcome.reasons.append("The source capture was restored to Inbox")
                except Exception:
                    restore_reason = "Publication failed and the archived source could not be restored automatically"
                    outcome.reasons.append(restore_reason)
                    logger.error(
                        "Failed to restore capture after publication failure", exc_info=True
                    )
            else:
                outcome.reasons.append(
                    "Publication failed before a recoverable source snapshot was available"
                )
            _record_publication_failure(vault_dir, capture_path, outcome.reasons)
            return outcome
    outcome.flagged = verdict == "warning"
    return outcome


def _restore_archived_capture(
    vault_dir: Path,
    capture_path: Path,
    archived_path: Path,
    original: str,
) -> None:
    """Restore an archive move without replacing any externally changed bytes.

    ``record_move`` refuses to overwrite a newly created Inbox source. The
    follow-up revision restore verifies that the moved archived bytes are still
    exactly what enforcement created before writing the pre-enforcement
    snapshot back. A concurrent external edit therefore wins rather than being
    overwritten.
    """
    from core.revisions import fingerprint, record_move, restore

    archived = archived_path.read_text(encoding="utf-8")
    if capture_path.exists():
        raise FileExistsError(f"Inbox capture already exists: {capture_path}")
    record_move(vault_dir, archived_path, capture_path)
    restore(vault_dir, capture_path, original, fingerprint(archived))


def _record_publication_failure(vault_dir: Path, capture_path: Path, reasons: list[str]) -> None:
    """Keep a durable actionable audit trail while the source bytes stay pristine."""
    try:
        from agents.changelog import log_action

        log_action(
            vault_dir,
            "weaver",
            "publication-recovery",
            str(capture_path),
            details="; ".join(reasons),
            chain_status="fail",
        )
    except Exception:  # pragma: no cover - audit logging must not hide recovery
        logger.warning("Failed to log publication recovery", exc_info=True)


def annotate_frontmatter(
    vault_dir: Path,
    path: Path,
    fields: dict[str, Any],
    *,
    strict: bool = False,
) -> bool:
    """Read a note, merge ``fields`` into frontmatter, write through ``vault_io``.

    Unknown user frontmatter keys are preserved (carried in ``Note.extra`` and
    re-emitted by ``build_frontmatter``). Callers can opt into ``strict`` for
    the publication commit; ordinary lifecycle annotations stay best-effort.
    """
    try:
        from core.notes import parse_note
        from core.vault_io import write_note

        note = parse_note(path)
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta.update(fields)
        write_note(vault_dir, path, meta, note.body)
        return True
    except Exception:
        logger.warning("Failed to annotate %s", path, exc_info=True)
        if strict:
            raise
        return False

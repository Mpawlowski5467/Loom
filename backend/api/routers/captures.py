"""Captures inbox API routes: listing, dry-run preview, and Weaver processing."""

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from core.note_index import NoteIndex, get_note_index
from core.notes import _WIKILINK_RE, Note, generate_id, parse_note
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, VaultPathError, get_vault_manager

if TYPE_CHECKING:
    from agents.chain import ReadChainResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/captures", tags=["captures"])


class CaptureItem(BaseModel):
    """A capture file with metadata and preview."""

    id: str = ""
    title: str = ""
    type: str = "capture"
    tags: list[str] = Field(default_factory=list)
    created: str = ""
    modified: str = ""
    author: str = ""
    source: str = ""
    status: str = "active"
    preview: str = ""
    body: str = ""
    file_path: str = ""


class ProcessCaptureRequest(BaseModel):
    """Request body for processing a single capture."""

    capture_path: str


class ProcessResult(BaseModel):
    """Result of processing a capture."""

    processed: bool
    note_id: str = ""
    note_title: str = ""
    note_type: str = ""
    target_path: str = ""
    error: str = ""
    linked: list[str] = Field(default_factory=list)
    suggested: list[str] = Field(default_factory=list)
    validation: str = ""
    validation_mode: str = ""
    # Sentinel enforcement outcomes — distinct from the raw verdict so
    # the UI can render the right affordance.
    capture_archived: bool = False  # False on failed → capture stays in inbox
    review_required: bool = False  # True on failed; UI surfaces the note
    flagged: bool = False  # True on warning; note ships but is annotated
    validation_reasons: list[str] = Field(default_factory=list)


class ProcessAllResult(BaseModel):
    """Result of processing all pending captures."""

    total: int
    processed: int
    results: list[ProcessResult]


class PreviewRequest(BaseModel):
    """Request body for a dry-run capture preview.

    The optional fields override Weaver's classification — sent when the user
    edits the suggestion and wants it re-previewed.
    """

    capture_path: str
    note_type: str | None = None
    folder: str | None = None
    title: str | None = None
    tags: list[str] | None = None


class PreviewLink(BaseModel):
    """A candidate wikilink Spider proposes for a previewed note."""

    note_id: str = ""
    title: str = ""
    score: float = 0.0
    decision: str = ""  # "auto-linked" | "suggested"


class CapturePreview(BaseModel):
    """Weaver's proposed filing for a capture, plus Spider's link candidates."""

    note_type: str = ""
    folder: str = ""
    title: str = ""
    tags: list[str] = Field(default_factory=list)
    body: str = ""
    links: list[PreviewLink] = Field(default_factory=list)


class PreviewResponse(BaseModel):
    """Wrapper so an empty capture returns ``preview: null`` instead of a 500."""

    preview: CapturePreview | None = None


class CommitRequest(BaseModel):
    """Request body for filing a previewed (and possibly edited) capture."""

    capture_path: str
    note_type: str
    folder: str
    title: str
    tags: list[str] = Field(default_factory=list)
    body: str


class CommitResult(BaseModel):
    """Result of committing a previewed capture.

    The created note is nested under ``note`` (a sibling envelope) so its
    stored ``links`` don't collide with Spider's freshly ``linked`` titles.
    """

    note: Note
    linked: list[str] = Field(default_factory=list)
    suggested: list[str] = Field(default_factory=list)
    validation: str = ""
    validation_mode: str = ""
    validation_reasons: list[str] = Field(default_factory=list)
    capture_archived: bool = False
    review_required: bool = False
    flagged: bool = False


def _extract_preview(body: str, max_lines: int = 2) -> str:
    """Extract the first non-empty lines as a preview."""
    lines = [ln for ln in body.strip().splitlines() if ln.strip()]
    return "\n".join(lines[:max_lines])


def _list_captures(captures_dir: Path) -> list[CaptureItem]:
    """List all markdown files in captures/ with metadata and preview."""
    items: list[CaptureItem] = []
    if not captures_dir.exists():
        return items

    for md_file in sorted(captures_dir.glob("*.md"), reverse=True):
        try:
            note = parse_note(md_file)
            items.append(
                CaptureItem(
                    id=note.id,
                    title=note.title,
                    type=note.type,
                    tags=note.tags,
                    created=note.created,
                    modified=note.modified,
                    author=note.author,
                    source=note.source,
                    status=note.status,
                    preview=_extract_preview(note.body),
                    body=note.body,
                    file_path=note.file_path,
                )
            )
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            continue

    return items


@router.get("")
def get_captures(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[CaptureItem]:
    """Return all capture files with metadata and preview text."""
    captures_dir = vm.active_threads_dir() / "captures"
    return _list_captures(captures_dir)


@router.post("/process")
@limiter.limit(WRITE_LIMIT)
async def process_capture(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: ProcessCaptureRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> ProcessResult:
    """Process a single capture through Weaver.

    The capture_path should be relative to threads/ or an absolute path.
    """
    # Validate path first (cheap, doesn't depend on agent state).
    try:
        capture_path = vm.resolve_capture_path(body.capture_path)
    except VaultPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    from agents.loom.weaver import get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

    if not capture_path.exists():
        raise HTTPException(status_code=404, detail=f"Capture not found: {body.capture_path}")

    from core.traces import clear_caller, set_caller

    try:
        set_caller("weaver")
        note, weaver_chain = await weaver.process_capture_full(capture_path)
        if note is None:
            return ProcessResult(processed=False, error="Empty capture, skipped")
        outcome = await _finalize_note(note, weaver_chain, capture_path, vm, index)
        return ProcessResult(
            processed=True,
            note_id=note.id,
            note_title=note.title,
            note_type=note.type,
            target_path=note.file_path,
            **outcome,
        )
    except Exception as exc:
        logger.warning("Capture processing failed", exc_info=True)
        return ProcessResult(processed=False, error=str(exc))
    finally:
        clear_caller()


async def _finalize_note(
    note: Note,
    weaver_chain: "ReadChainResult | None",
    capture_path: Path,
    vm: VaultManager,
    index: NoteIndex,
) -> dict[str, Any]:
    """Run the post-write chain shared by ``/process`` and ``/commit``.

    Refreshes the index, runs Spider (auto-link) then Sentinel (validate), and
    enforces the three Sentinel outcomes (passed/warning → archive the capture;
    failed → keep it in the inbox flagged for review). Returns the outcome
    fields the response models share. The caller owns the outer
    ``set_caller('weaver')`` / ``clear_caller()`` bracket.
    """
    from core.traces import clear_caller, set_caller

    note_path = Path(note.file_path)
    index.refresh_file(note_path)

    # Chain: Spider links the new note, then Sentinel validates.
    linked: list[str] = []
    suggested: list[str] = []
    validation_status = ""
    validation_mode = ""
    validation_reasons: list[str] = []
    try:
        from agents.loom.spider import get_spider

        spider = get_spider()
        if spider is not None:
            clear_caller()
            set_caller("spider")
            spider_report = await spider.scan_and_report(note_path)
            linked = list(spider_report.auto_linked)
            suggested = list(spider_report.suggested)
            index.refresh_file(note_path)
    except Exception:
        logger.warning("Spider scan failed for new note", exc_info=True)

    try:
        from agents.loom.sentinel import get_sentinel

        sentinel = get_sentinel()
        if sentinel is not None and weaver_chain is not None:
            clear_caller()
            set_caller("sentinel")
            validation = await sentinel.validate_action(
                "weaver", "created", note_path, weaver_chain
            )
            validation_status = validation.status
            validation_mode = validation.mode_summary
            validation_reasons = list(validation.reasons)
    except Exception:
        logger.warning("Sentinel validation failed for new note", exc_info=True)

    # Sentinel enforcement. Three outcomes:
    #   passed  → archive capture, ship the note clean
    #   warning → archive capture, annotate the new note as "flagged"
    #   failed  → keep capture in inbox marked review_required;
    #             the note exists but the user is warned to check it
    capture_archived = False
    review_required = False
    flagged = False
    if validation_status == "failed":
        review_required = True
        _annotate_note_review_required(note_path, validation_reasons)
        _flag_capture_for_review(capture_path, validation_reasons)
    else:
        # passed or warning (or no sentinel) → archive the capture.
        try:
            from agents.loom.weaver_io import archive_capture

            archive_capture(vm.active_vault_dir(), "weaver", capture_path)
            capture_archived = True
        except Exception:
            logger.warning("Capture archive failed", exc_info=True)
        if validation_status == "warning":
            flagged = True
            _annotate_note_flagged(note_path, validation_reasons)

    return {
        "linked": linked,
        "suggested": suggested,
        "validation": validation_status,
        "validation_mode": validation_mode,
        "validation_reasons": validation_reasons,
        "capture_archived": capture_archived,
        "review_required": review_required,
        "flagged": flagged,
    }


def _annotate_note_review_required(note_path: Path, reasons: list[str]) -> None:
    """Mark a Sentinel-failed note with ``review_required: true`` in frontmatter."""
    _annotate_frontmatter(
        note_path,
        {"review_required": True, "review_reasons": reasons},
    )


def _annotate_note_flagged(note_path: Path, reasons: list[str]) -> None:
    """Mark a Sentinel-warning note with ``flagged: true`` in frontmatter."""
    _annotate_frontmatter(
        note_path,
        {"flagged": True, "flag_reasons": reasons},
    )


def _flag_capture_for_review(capture_path: Path, reasons: list[str]) -> None:
    """Mark a capture that Sentinel rejected so the inbox shows the warning."""
    _annotate_frontmatter(
        capture_path,
        {"review_required": True, "review_reasons": reasons},
    )


def _annotate_frontmatter(path: Path, fields: dict) -> None:
    """Read a note, merge ``fields`` into frontmatter, write atomically.

    Best-effort: failure is logged but does not raise — the user-visible
    flow (note created, capture maybe archived) is more important than
    the annotation.
    """
    try:
        from core.notes import atomic_write_text, build_frontmatter

        note = parse_note(path)
        meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta.update(fields)
        new_content = build_frontmatter(meta) + "\n" + note.body
        atomic_write_text(path, new_content)
    except Exception:
        logger.warning("Failed to annotate %s", path, exc_info=True)


@router.post("/preview")
@limiter.limit(READ_LIMIT)
async def preview_capture(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: PreviewRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> PreviewResponse:
    """Dry-run: return Weaver's proposed filing + Spider's link candidates.

    Writes nothing — no note, no index refresh, no changelog. The optional
    override fields let the inbox re-preview after the user edits the
    suggestion. An empty capture returns ``preview: null``.
    """
    try:
        capture_path = vm.resolve_capture_path(body.capture_path)
    except VaultPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    from agents.loom.weaver import get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

    if not capture_path.exists():
        raise HTTPException(status_code=404, detail=f"Capture not found: {body.capture_path}")

    overrides: dict[str, Any] | None = None
    if body.note_type:
        overrides = {
            "note_type": body.note_type,
            "folder": body.folder,
            "title": body.title,
            "tags": body.tags or [],
        }

    from core.traces import clear_caller, set_caller

    try:
        set_caller("weaver")
        proposal = await weaver.propose_capture(capture_path, overrides)
        if proposal is None:
            return PreviewResponse(preview=None)

        # Spider scores against an in-memory note. Use a FRESH id, never the
        # capture's — the capture is indexed, so its id would self-match and
        # pull spurious graph-boost.
        preview_note = Note(
            id=generate_id(),
            title=proposal.title,
            type=proposal.note_type,
            tags=proposal.tags,
            body=proposal.body,
            wikilinks=_WIKILINK_RE.findall(proposal.body),
        )

        links: list[PreviewLink] = []
        from agents.loom.spider import get_spider

        spider = get_spider()
        if spider is not None:
            clear_caller()
            set_caller("spider")
            try:
                existing = {wl.lower() for wl in preview_note.wikilinks}
                candidates = await spider.propose_candidates(preview_note, existing)
                links = [
                    PreviewLink(
                        note_id=c.note_id,
                        title=c.title,
                        score=round(c.score, 4),
                        decision=c.decision,
                    )
                    for c in candidates
                    if c.decision in ("auto-linked", "suggested")
                ]
            except Exception:
                logger.warning("Spider preview scan failed", exc_info=True)

        return PreviewResponse(
            preview=CapturePreview(
                note_type=proposal.note_type,
                folder=proposal.folder,
                title=proposal.title,
                tags=proposal.tags,
                body=proposal.body,
                links=links,
            )
        )
    finally:
        clear_caller()


@router.post("/commit")
@limiter.limit(WRITE_LIMIT)
async def commit_capture(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: CommitRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> CommitResult:
    """File a previewed (and possibly edited) capture.

    Writes the proposal verbatim (no re-classify/regenerate), then runs the
    same Spider + Sentinel + archive chain as ``/process``.
    """
    try:
        capture_path = vm.resolve_capture_path(body.capture_path)
    except VaultPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    from agents.loom.weaver import CaptureProposal, get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

    # Re-validate existence — the capture may have been processed since preview.
    if not capture_path.exists():
        raise HTTPException(status_code=404, detail=f"Capture not found: {body.capture_path}")

    from core.traces import clear_caller, set_caller

    try:
        set_caller("weaver")
        proposal = CaptureProposal(
            note_type=body.note_type,
            folder=body.folder,
            title=body.title,
            tags=body.tags,
            body=body.body,
        )
        note, weaver_chain = await weaver.commit_proposal(capture_path, proposal)
        if note is None:
            raise HTTPException(status_code=400, detail="Failed to write note")
        outcome = await _finalize_note(note, weaver_chain, capture_path, vm, index)
        return CommitResult(note=note, **outcome)
    finally:
        clear_caller()


@router.post("/process-all")
@limiter.limit(WRITE_LIMIT)
async def process_all_captures(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> ProcessAllResult:
    """Process all pending captures in the inbox through Weaver."""
    from agents.loom.weaver import get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

    captures_dir = vm.active_threads_dir() / "captures"
    if not captures_dir.exists():
        return ProcessAllResult(total=0, processed=0, results=[])

    md_files = sorted(captures_dir.glob("*.md"))
    results: list[ProcessResult] = []

    for capture_path in md_files:
        try:
            note = await weaver.process_capture(capture_path)
            if note is None:
                results.append(ProcessResult(processed=False, error="Empty capture"))
                continue
            index.refresh_file(Path(note.file_path))
            results.append(
                ProcessResult(
                    processed=True,
                    note_id=note.id,
                    note_title=note.title,
                    note_type=note.type,
                    target_path=note.file_path,
                )
            )
        except Exception as exc:
            logger.warning("Capture processing failed for %s", capture_path, exc_info=True)
            results.append(ProcessResult(processed=False, error=str(exc)))

    processed_count = sum(1 for r in results if r.processed)
    return ProcessAllResult(
        total=len(md_files),
        processed=processed_count,
        results=results,
    )

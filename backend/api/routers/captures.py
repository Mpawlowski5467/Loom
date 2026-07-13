"""Captures inbox API routes: listing, dry-run preview, and Weaver processing."""

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request
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


def _pipeline_result_to_process_result(result: Any) -> ProcessResult:
    """Map a :class:`PipelineResult` to the API ``ProcessResult`` envelope.

    Shared by ``/process`` and ``/process-all`` so both report the same fields
    (validation verdict + enforcement outcomes), instead of ``/process-all``
    running a degraded Weaver-only path.
    """
    note = result.note
    if note is None:
        err = "; ".join(result.errors) if result.errors else "Empty capture, skipped"
        return ProcessResult(processed=False, error=err)
    validation = result.validation
    error = "; ".join(result.errors)
    if not error and result.review_required and validation is not None:
        error = "; ".join(validation.reasons)
    return ProcessResult(
        processed=True,
        note_id=note.id,
        note_title=note.title,
        note_type=note.type,
        target_path=note.file_path,
        linked=result.links_added,
        suggested=result.suggested,
        validation=validation.status if validation else "",
        validation_mode=validation.mode_summary if validation else "",
        validation_reasons=list(validation.reasons) if validation else [],
        error=error,
        capture_archived=result.capture_archived,
        review_required=result.review_required,
        flagged=result.flagged,
    )


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
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[CaptureItem]:
    """Return capture files with metadata and preview text, newest first.

    Paginated via ``offset``/``limit`` (default 200) so a very large inbox
    doesn't return every capture body in a single unbounded response. The
    common case (a handful of captures) is unaffected.
    """
    captures_dir = vm.active_threads_dir() / "captures"
    items = _list_captures(captures_dir)
    return items[offset : offset + limit]


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

    from agents.runner import AgentRunner

    # Build the runner from the request's injected vault rather than the global
    # singleton: the singleton is for scheduled/background runs and may point at
    # a different active vault than this request's dependency-injected one.
    runner = AgentRunner(vm.active_vault_dir())

    try:
        # Drive the LangGraph capture pipeline (Weaver → Spider → Scribe →
        # Sentinel with a Sentinel-retry loop). Passing index.refresh_file keeps
        # the search index hot after each write, matching the old inline path.
        result = await runner.run_pipeline(capture_path, refresh_index=index.refresh_file)
        return _pipeline_result_to_process_result(result)
    except Exception as exc:
        logger.warning("Capture processing failed", exc_info=True)
        return ProcessResult(processed=False, error=str(exc))


async def _finalize_note(
    note: Note,
    weaver_chain: "ReadChainResult | None",
    capture_path: Path,
    vm: VaultManager,
    index: NoteIndex,
) -> dict[str, Any]:
    """Validate a committed proposal before publishing downstream side effects.

    Sentinel runs first. Only an explicit passed/warning verdict allows index
    refresh, Spider backlink mutations, Scribe index generation, or capture
    archival. Missing/errored validation is represented as ``unavailable`` and
    kept in the inbox for review. The caller owns the outer caller-tag bracket.
    """
    from core.traces import clear_caller, set_caller

    note_path = Path(note.file_path)
    linked: list[str] = []
    suggested: list[str] = []
    validation_status = ""
    validation_mode = ""
    validation_reasons: list[str] = []

    # Validate before Spider/Scribe mutate any other vault artifacts.
    try:
        from agents.chain import ReadChain
        from agents.loom.sentinel import get_sentinel

        sentinel = get_sentinel()
        if sentinel is None:
            validation_status = "unavailable"
            validation_mode = "unavailable"
            validation_reasons = ["Sentinel agent not initialized"]
        else:
            if weaver_chain is None:
                weaver_chain = await asyncio.to_thread(
                    ReadChain(vm.active_vault_dir(), note_index=index).execute,
                    "weaver",
                    note_path,
                )
            clear_caller()
            set_caller("sentinel")
            validation = await sentinel.validate_action(
                "weaver", "created", note_path, weaver_chain
            )
            validation_status = validation.status
            validation_mode = validation.mode_summary
            validation_reasons = list(validation.reasons)
    except Exception as exc:
        logger.warning("Sentinel validation failed for new note", exc_info=True)
        validation_status = "unavailable"
        validation_mode = "unavailable"
        validation_reasons = [f"Sentinel failed: {exc}"]

    if validation_status in {"passed", "warning"}:
        index.refresh_file(note_path)

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
            from agents.loom.scribe import get_scribe

            scribe = get_scribe()
            if scribe is not None:
                clear_caller()
                set_caller("scribe")
                await scribe.update_index(note_path.parent)
        except Exception:
            logger.warning("Scribe index update failed for new note", exc_info=True)

    # Shared fail-closed enforcement: only explicit passed/warning archives.
    from agents.loom.enforcement import enforce_verdict

    outcome = enforce_verdict(
        vm.active_vault_dir(), capture_path, note_path, validation_status, validation_reasons
    )

    return {
        "linked": linked,
        "suggested": suggested,
        "validation": validation_status,
        "validation_mode": validation_mode,
        "validation_reasons": validation_reasons,
        "capture_archived": outcome.capture_archived,
        "review_required": outcome.review_required,
        "flagged": outcome.flagged,
    }


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

    from agents.file_locks import path_lock
    from core.traces import clear_caller, set_caller

    async with path_lock(capture_path):
        # Re-validate existence under the same lock used by auto-processing.
        if not capture_path.exists():
            raise HTTPException(status_code=404, detail=f"Capture not found: {body.capture_path}")

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
    """Process all pending captures through the full capture pipeline.

    Each capture runs the same Weaver → Spider → Scribe → Sentinel → enforce
    pipeline (with the Sentinel-retry loop and idempotency guard) as
    ``/process`` — not a degraded Weaver-only path that skipped linking,
    validation, and archiving and left every capture in the inbox.
    """
    from agents.loom.weaver import get_weaver

    if get_weaver() is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

    captures_dir = vm.active_threads_dir() / "captures"
    if not captures_dir.exists():
        return ProcessAllResult(total=0, processed=0, results=[])

    md_files = sorted(captures_dir.glob("*.md"))
    if not md_files:
        return ProcessAllResult(total=0, processed=0, results=[])

    from agents.runner import AgentRunner

    runner = AgentRunner(vm.active_vault_dir())
    results: list[ProcessResult] = []

    for capture_path in md_files:
        try:
            result = await runner.run_pipeline(capture_path, refresh_index=index.refresh_file)
            results.append(_pipeline_result_to_process_result(result))
        except Exception as exc:
            logger.warning("Capture processing failed for %s", capture_path, exc_info=True)
            results.append(ProcessResult(processed=False, error=str(exc)))

    processed_count = sum(1 for r in results if r.processed)
    return ProcessAllResult(
        total=len(md_files),
        processed=processed_count,
        results=results,
    )

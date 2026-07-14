"""Captures inbox API routes: listing, dry-run preview, and Weaver processing."""

import asyncio
import logging
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, ValidationError, field_validator

from core.capture_ingress import CaptureIngressError, ingest_capture
from core.capture_jobs import (
    CaptureJob,
    CaptureJobConflictError,
    CaptureJobNotFoundError,
    CaptureJobsBusyError,
    CaptureJobStatus,
    JobExecutionResult,
    capture_job_store,
    get_capture_job_service,
    publish_job_change,
)
from core.config import CaptureProcessingConfig, GlobalConfig
from core.events import publish_capture_change, publish_note_change
from core.note_index import NoteIndex, get_note_index
from core.notes import _WIKILINK_RE, Note, generate_id, now_iso, parse_note
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, VaultPathError, get_vault_manager
from core.vault_io import VaultIOError
from core.vault_io import write_note as vault_write_note

if TYPE_CHECKING:
    from agents.chain import ReadChainResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/captures", tags=["captures"])

CaptureOutcome = Literal["filed", "needs_review", "skipped", "failed"]


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
    # Capture-gateway provenance. These are optional frontmatter extensions so
    # hand-written/legacy captures remain fully compatible.
    external_id: str | None = None
    provenance: dict[str, Any] = Field(default_factory=dict)
    # Durable Inbox/enforcement state. ``enforcement_outcome`` is absent for a
    # newly-arrived capture that has not been processed yet.
    enforcement_outcome: CaptureOutcome | None = None
    review_required: bool = False
    review_reasons: list[str] = Field(default_factory=list)
    flagged: bool = False
    flag_reasons: list[str] = Field(default_factory=list)
    validation: str = ""
    validation_mode: str = ""
    validation_reasons: list[str] = Field(default_factory=list)
    draft_note_id: str = ""
    draft_note_path: str = ""
    last_attempt_outcome: CaptureOutcome | None = None
    last_error: str = ""
    last_attempt_at: str = ""


class CreateCaptureRequest(BaseModel):
    """A new item entering Loom's Inbox through an external or local bridge."""

    title: str = Field(min_length=1, max_length=300)
    body: str = ""
    source: str = Field(default="manual", min_length=1, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=100)
    external_id: str | None = Field(default=None, max_length=500)
    provenance: dict[str, Any] = Field(default_factory=dict)

    @field_validator("title", "source")
    @classmethod
    def _strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("external_id")
    @classmethod
    def _strip_external_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, values: list[str]) -> list[str]:
        tags: list[str] = []
        seen: set[str] = set()
        for raw in values:
            tag = raw.strip()
            if not tag or tag in seen:
                continue
            if len(tag) > 100:
                raise ValueError("tags must be at most 100 characters")
            seen.add(tag)
            tags.append(tag)
        return tags


class CreateCaptureResponse(BaseModel):
    """Creation result; retries with the same external key return the original."""

    capture: CaptureItem
    created: bool
    deduplicated: bool
    job: CaptureJob | None = None


class ProcessCaptureRequest(BaseModel):
    """Request body for processing a single capture."""

    capture_path: str


class EnqueueCaptureJobRequest(BaseModel):
    """Explicitly queue one Inbox capture, regardless of automatic policy."""

    capture_path: str
    force: bool = False


class EnqueueCaptureJobsRequest(BaseModel):
    """Queue several Inbox captures in one rate-limited request."""

    capture_paths: list[str] = Field(min_length=1, max_length=500)
    force: bool = False


class PruneCaptureJobHistoryResponse(BaseModel):
    """Count of completed/cancelled ledger rows removed by retention."""

    deleted: int


class CaptureProcessingPatch(BaseModel):
    """Partial update for the durable Inbox processing policy."""

    mode: Literal["manual", "trusted", "all"] | None = None
    trusted_sources: list[str] | None = Field(default=None, max_length=200)
    concurrency: int | None = Field(default=None, ge=1, le=8)
    max_retries: int | None = Field(default=None, ge=0, le=10)
    base_backoff_seconds: float | None = Field(default=None, ge=0.1, le=3600.0)


class SkipCaptureRequest(BaseModel):
    """Request body for durably skipping (archiving) an Inbox capture."""

    capture_path: str
    reason: str = Field(default="Skipped from Inbox", max_length=1000)

    @field_validator("reason")
    @classmethod
    def _normalize_reason(cls, value: str) -> str:
        return value.strip() or "Skipped from Inbox"


class ProcessResult(BaseModel):
    """Result of processing a capture."""

    processed: bool
    outcome: CaptureOutcome
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
    filed: int = 0
    needs_review: int = 0
    skipped: int = 0
    failed: int = 0
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
    outcome: Literal["filed", "needs_review", "failed"] = "failed"


def _extract_preview(body: str, max_lines: int = 2) -> str:
    """Extract the first non-empty lines as a preview."""
    lines = [ln for ln in body.strip().splitlines() if ln.strip()]
    return "\n".join(lines[:max_lines])


def _string_list(value: Any) -> list[str]:
    """Return a safe string-list view of optional custom frontmatter."""
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def _capture_item(note: Note) -> CaptureItem:
    """Project a parsed capture (including custom metadata) into the API model."""
    extra = note.extra
    review_required = extra.get("review_required") is True
    raw_outcome = extra.get("enforcement_outcome")
    outcome: CaptureOutcome | None = (
        raw_outcome
        if raw_outcome in {"filed", "needs_review", "skipped", "failed"}
        else "needs_review"
        if review_required
        else None
    )
    external_id = extra.get("external_id")
    provenance = extra.get("provenance")
    return CaptureItem(
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
        external_id=str(external_id) if external_id is not None else None,
        provenance=provenance if isinstance(provenance, dict) else {},
        enforcement_outcome=outcome,
        review_required=review_required,
        review_reasons=_string_list(extra.get("review_reasons")),
        flagged=extra.get("flagged") is True,
        flag_reasons=_string_list(extra.get("flag_reasons")),
        validation=str(extra.get("validation") or ""),
        validation_mode=str(extra.get("validation_mode") or ""),
        validation_reasons=_string_list(extra.get("validation_reasons")),
        draft_note_id=str(extra.get("draft_note_id") or ""),
        draft_note_path=str(extra.get("draft_note_path") or ""),
        last_attempt_outcome=(
            extra.get("last_attempt_outcome")
            if extra.get("last_attempt_outcome") in {"filed", "needs_review", "skipped", "failed"}
            else None
        ),
        last_error=str(extra.get("last_error") or ""),
        last_attempt_at=str(extra.get("last_attempt_at") or ""),
    )


def _resolve_inbox_capture(vm: VaultManager, user_path: str) -> Path:
    """Resolve and validate an active capture inside ``threads/captures``.

    ``VaultManager.resolve_capture_path`` intentionally accepts any Markdown
    note under ``threads/``. Capture operations are more destructive: commit
    and process may create a draft and archive their input, so they must never
    accept an ordinary topic/project note.
    """
    try:
        capture_path = vm.resolve_capture_path(user_path)
    except VaultPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    captures_dir = (vm.active_threads_dir() / "captures").resolve()
    try:
        capture_path.relative_to(captures_dir)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="Only notes in the active Inbox can be processed as captures",
        ) from exc

    if not capture_path.exists():
        raise HTTPException(status_code=404, detail=f"Capture not found: {user_path}")
    try:
        capture = parse_note(capture_path)
    except (OSError, yaml.YAMLError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Capture is not a valid note") from exc
    if capture.type != "capture":
        raise HTTPException(status_code=400, detail="Inbox item is not a capture note")
    return capture_path


def _persist_failed_attempt(vault_root: Path, capture_path: Path, error: str) -> bool:
    """Persist a retryable processing failure without hiding prior review state."""
    try:
        capture = parse_note(capture_path)
        if capture.type != "capture":
            return False
        ts = now_iso()
        meta = capture.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta.update(
            {
                "modified": ts,
                "last_attempt_outcome": "failed",
                "last_error": error or "Capture processing failed",
                "last_attempt_at": ts,
            }
        )
        if capture.extra.get("review_required") is not True:
            meta["enforcement_outcome"] = "failed"
        vault_write_note(vault_root, capture_path, meta, capture.body)
        return True
    except Exception:
        # Returning the failure to the caller matters more than this audit
        # annotation; never mask the original processing error.
        logger.warning("Failed to persist capture processing error", exc_info=True)
        return False


def _unique_archive_path(archive_dir: Path, filename: str, capture_id: str) -> Path:
    """Choose an archive destination without ever replacing an existing file."""
    destination = archive_dir / filename
    if not destination.exists():
        return destination

    suffix = capture_id or generate_id()
    destination = destination.with_stem(f"{destination.stem}-{suffix}")
    counter = 2
    while destination.exists():
        destination = (archive_dir / filename).with_stem(
            f"{Path(filename).stem}-{suffix}-{counter}"
        )
        counter += 1
    return destination


def _pipeline_result_to_process_result(result: Any) -> ProcessResult:
    """Map a :class:`PipelineResult` to the API ``ProcessResult`` envelope.

    Shared by ``/process`` and ``/process-all`` so both report the same fields
    (validation verdict + enforcement outcomes), instead of ``/process-all``
    running a degraded Weaver-only path.
    """
    note = result.note
    if note is None:
        errors = list(result.errors)
        err = "; ".join(errors) if errors else "Empty capture cannot be processed"
        return ProcessResult(
            processed=False,
            # ``skipped`` is reserved for the durable /skip operation, which
            # archives the source. An empty capture remains in Inbox, so call
            # it failed rather than claiming a lifecycle transition that did
            # not happen.
            outcome="failed",
            error=err,
        )
    validation = result.validation
    error = "; ".join(result.errors)
    if not error and result.review_required and validation is not None:
        error = "; ".join(validation.reasons)
    outcome: CaptureOutcome
    if result.review_required:
        outcome = "needs_review"
    elif result.capture_archived:
        outcome = "filed"
    else:
        # A note exists, but the capture neither archived nor carries an
        # explicit review verdict (for example, an archive IO failure). It is
        # not honest to call that filed.
        outcome = "failed"
    return ProcessResult(
        processed=outcome == "filed",
        outcome=outcome,
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


def _publish_process_resource_changes(
    result: ProcessResult, *, capture_metadata_changed: bool = False
) -> None:
    """Publish scoped filesystem signals separately from the durable job row."""
    capture_changed = (
        capture_metadata_changed
        or bool(result.note_id)
        or result.capture_archived
        or result.review_required
        or result.flagged
    )
    if capture_changed:
        publish_capture_change()
    if result.note_id:
        publish_note_change()


def _list_captures(captures_dir: Path) -> list[CaptureItem]:
    """List all markdown files in captures/ with metadata and preview."""
    items: list[CaptureItem] = []
    if not captures_dir.exists():
        return items

    for md_file in sorted(captures_dir.glob("*.md"), reverse=True):
        try:
            note = parse_note(md_file)
            items.append(_capture_item(note))
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            continue

    items.sort(key=lambda item: (item.created, item.file_path), reverse=True)
    return items


def _capture_processing_policy(vm: VaultManager) -> CaptureProcessingConfig:
    """Load the active persisted processing policy for a request."""
    return GlobalConfig.load(vm.config_path()).capture_processing


async def _ensure_capture_worker(
    vm: VaultManager,
    policy: CaptureProcessingConfig,
    vault_root: Path | None = None,
) -> None:
    """Best-effort recovery when lifecycle enabled but worker startup failed."""
    service = get_capture_job_service()
    if not service.enabled:
        return
    root = (vault_root or vm.active_vault_dir()).resolve()
    if vm.active_vault_dir().resolve() != root:
        return
    worker = service.worker
    if worker is not None and worker.vault_root == root:
        return
    try:
        await service.ensure_active(root, policy)
    except CaptureJobsBusyError:
        logger.debug("Capture worker self-heal deferred during vault handoff")
    except Exception:
        logger.warning("Could not activate capture worker", exc_info=True)


def _job_execution_from_process_result(result: ProcessResult) -> JobExecutionResult:
    """Map the synchronous API envelope onto a durable job terminal state."""
    if result.outcome == "filed":
        status: Literal["completed", "needs_review", "failed"] = "completed"
        outcome: Literal["filed", "needs_review", "failed"] = "filed"
    elif result.outcome == "needs_review":
        status = "needs_review"
        outcome = "needs_review"
    else:
        status = "failed"
        outcome = "failed"
    return JobExecutionResult(
        status=status,
        outcome=outcome,
        error=result.error,
        note_id=result.note_id,
        note_title=result.note_title,
        note_type=result.note_type,
        target_path=result.target_path,
    )


def _capture_vault_root(capture_path: Path) -> Path:
    """Recover the validated Inbox path's vault root without rereading config."""
    return capture_path.resolve().parents[2]


async def _cancel_pending_job_unlocked(
    vault_root: Path, capture_path: Path, reason: str
) -> tuple[str, CaptureJob | None, CaptureJob | None]:
    """Cancel queued work while the caller owns the operation guard.

    Returns the stable capture id for post-operation reconciliation. A running
    worker is rejected rather than racing a manual process/skip against it.
    """
    capture = await asyncio.to_thread(parse_note, capture_path)
    store = capture_job_store(vault_root)
    cancellation_task = asyncio.create_task(
        asyncio.to_thread(store.cancel_by_capture_with_snapshot, capture.id, reason)
    )
    try:
        previous, job = await asyncio.shield(cancellation_task)
    except asyncio.CancelledError:
        # ``to_thread`` keeps running after its awaiting request is cancelled.
        # Recover the committed snapshot before propagating cancellation so a
        # job never remains terminal while its capture is still actionable.
        previous, _ = await cancellation_task
        await asyncio.shield(_restore_cancelled_job_unlocked(vault_root, previous))
        raise
    return capture.id, previous, job


async def _restore_cancelled_job_unlocked(
    vault_root: Path,
    snapshot: CaptureJob | None,
) -> None:
    """Compensate a skip cancellation when its filesystem mutation fails."""
    if snapshot is None:
        return
    await asyncio.to_thread(capture_job_store(vault_root).restore_cancelled, snapshot)
    get_capture_job_service().notify(vault_root)


async def _reserve_capture_job(vm: VaultManager, capture_path: Path) -> CaptureJob:
    """Create/claim the durable running row for a synchronous pipeline."""
    vault_root = _capture_vault_root(capture_path)
    capture = await asyncio.to_thread(parse_note, capture_path)
    reservation_task = asyncio.create_task(
        get_capture_job_service().reserve_external(
            vault_root,
            capture_path,
            capture.id,
            capture.source,
            _capture_processing_policy(vm),
        )
    )
    try:
        # SQLite work runs in a thread. Shield it so cancellation cannot hide a
        # committed ``running`` row before the caller receives its job id.
        job = await asyncio.shield(reservation_task)
    except asyncio.CancelledError:
        try:
            orphaned = await reservation_task
        except BaseException:
            # No completed reservation means there is no known row to clean up.
            pass
        else:
            try:
                await asyncio.shield(
                    _finish_reserved_job(
                        orphaned,
                        JobExecutionResult(
                            status="failed",
                            outcome="failed",
                            error="Processing request cancelled before execution",
                        ),
                    )
                )
            except Exception:
                logger.exception(
                    "Could not clean up cancelled capture reservation %s",
                    orphaned.id,
                )
        raise
    except (CaptureJobConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    publish_job_change()
    return job


async def _finish_reserved_job(job: CaptureJob, result: JobExecutionResult) -> None:
    """Terminalize the exact caller-owned running reservation."""
    vault_root = _capture_vault_root(Path(job.capture_path))
    try:
        await asyncio.to_thread(capture_job_store(vault_root).finish, job.id, result)
    except (CaptureJobConflictError, CaptureJobNotFoundError):
        logger.error("Could not finalize capture job %s", job.id, exc_info=True)
        return
    publish_job_change()


async def _fail_reserved_jobs(reservations: list[CaptureJob], error: str) -> None:
    """Best-effort terminalization for a partially reserved synchronous batch."""
    await asyncio.gather(
        *(
            _finish_reserved_job(
                reservation,
                JobExecutionResult(status="failed", outcome="failed", error=error),
            )
            for reservation in reservations
        ),
        return_exceptions=True,
    )


async def _enqueue_capture_job_unlocked(
    vault_root: Path,
    capture_path: Path,
    policy: CaptureProcessingConfig,
    *,
    force: bool,
) -> tuple[CaptureJob, bool]:
    """Write one job while the caller owns the active-vault operation guard."""
    capture = await asyncio.to_thread(parse_note, capture_path)
    store = capture_job_store(vault_root)
    result = await asyncio.to_thread(
        store.enqueue,
        capture_path,
        capture.id,
        capture.source,
        policy,
        force=force,
    )
    return result.job, result.created or force


async def _enqueue_capture_job(vm: VaultManager, capture_path: Path, *, force: bool) -> CaptureJob:
    """Validate and durably enqueue one explicit job."""
    vault_root = _capture_vault_root(capture_path)
    policy = _capture_processing_policy(vm)
    service = get_capture_job_service()
    try:
        async with service.operation_guard(vault_root):
            job, changed = await _enqueue_capture_job_unlocked(
                vault_root, capture_path, policy, force=force
            )
    except CaptureJobsBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if changed:
        publish_job_change()
    await _ensure_capture_worker(vm, policy, vault_root)
    service.notify(vault_root)
    return job


@router.post("", status_code=201)
@limiter.limit(WRITE_LIMIT)
async def create_capture(
    request: Request,  # noqa: ARG001 — required by slowapi
    response: Response,
    body: CreateCaptureRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> CreateCaptureResponse:
    """Create a durable Inbox capture, idempotent on ``source+external_id``.

    The server owns the destination path and writes through ``vault_io``. A
    retry with an external id returns the original capture (including an
    archived one) with HTTP 200; first creation returns HTTP 201.
    """
    vault_root = vm.active_vault_dir().resolve()
    policy = _capture_processing_policy(vm)
    try:
        result = await ingest_capture(
            vault_root,
            title=body.title,
            body=body.body,
            source=body.source,
            tags=body.tags,
            external_id=body.external_id,
            provenance=body.provenance,
            policy=policy,
            index=index,
        )
    except CaptureJobsBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (CaptureIngressError, VaultIOError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.deduplicated:
        response.status_code = 200
    return CreateCaptureResponse(
        capture=_capture_item(result.capture),
        created=result.created,
        deduplicated=result.deduplicated,
        job=result.job,
    )


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


@router.get("/processing-policy")
def get_capture_processing_policy(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CaptureProcessingConfig:
    """Return the active automatic-enqueue and worker policy."""
    return _capture_processing_policy(vm)


@router.patch("/processing-policy")
@limiter.limit(WRITE_LIMIT)
async def patch_capture_processing_policy(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: CaptureProcessingPatch,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CaptureProcessingConfig:
    """Persist a partial processing-policy update and apply it immediately."""
    vault_root = vm.active_vault_dir().resolve()
    config = GlobalConfig.load(vm.config_path())
    updates = body.model_dump(exclude_none=True)
    policy = config.capture_processing.model_copy(update=updates)
    # Re-validate after model_copy: Pydantic intentionally skips validation for
    # copied update values, while allowlist normalization belongs at this API
    # boundary.
    policy = CaptureProcessingConfig.model_validate(policy.model_dump())
    config.capture_processing = policy
    config.save(vm.config_path())
    service = get_capture_job_service()
    if service.enabled and vault_root.exists():
        try:
            await service.ensure_active(vault_root, policy)
        except CaptureJobsBusyError:
            logger.debug("Capture policy worker update deferred during vault handoff")
        except Exception:
            logger.warning("Could not apply capture worker policy", exc_info=True)
    publish_job_change()
    return policy


@router.get("/jobs")
def list_capture_jobs(
    status: CaptureJobStatus | None = Query(default=None),  # noqa: B008
    limit: int = Query(default=200, ge=1, le=1000),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[CaptureJob]:
    """Return active jobs first, then recent terminal outcomes."""
    return capture_job_store(vm.active_vault_dir()).list_jobs(status=status, limit=limit)


@router.post("/jobs/enqueue")
@limiter.limit(WRITE_LIMIT)
async def enqueue_capture_job(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: EnqueueCaptureJobRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CaptureJob:
    """Explicitly enqueue one capture; duplicate requests return the same job."""
    capture_path = _resolve_inbox_capture(vm, body.capture_path)
    return await _enqueue_capture_job(vm, capture_path, force=body.force)


@router.post("/jobs/enqueue-batch")
@limiter.limit(WRITE_LIMIT)
async def enqueue_capture_jobs(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: EnqueueCaptureJobsRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[CaptureJob]:
    """Explicitly enqueue several captures in one idempotent request."""
    capture_paths: list[Path] = []
    seen: set[str] = set()
    for raw_path in body.capture_paths:
        capture_path = _resolve_inbox_capture(vm, raw_path)
        normalized = str(capture_path)
        if normalized in seen:
            continue
        seen.add(normalized)
        capture_paths.append(capture_path)

    vault_root = _capture_vault_root(capture_paths[0])
    policy = _capture_processing_policy(vm)
    service = get_capture_job_service()
    jobs: list[CaptureJob] = []
    changed = False
    try:
        # Keep the full batch bound to one vault even if an active-vault change
        # arrives while SQLite work is yielding to its thread.
        async with service.operation_guard(vault_root):
            for capture_path in capture_paths:
                job, job_changed = await _enqueue_capture_job_unlocked(
                    vault_root, capture_path, policy, force=body.force
                )
                jobs.append(job)
                changed = changed or job_changed
    except CaptureJobsBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if changed:
        publish_job_change()
    await _ensure_capture_worker(vm, policy, vault_root)
    service.notify(vault_root)
    return jobs


@router.delete("/jobs/history")
@limiter.limit(WRITE_LIMIT)
async def prune_capture_job_history(
    request: Request,  # noqa: ARG001 — required by slowapi
    older_than_days: int | None = Query(default=None, ge=1, le=3650),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> PruneCaptureJobHistoryResponse:
    """Apply Inbox history retention without deleting actionable failures."""
    cutoff = (
        datetime.now(UTC) - timedelta(days=older_than_days) if older_than_days is not None else None
    )
    deleted = await asyncio.to_thread(
        capture_job_store(vm.active_vault_dir()).prune_history,
        before=cutoff,
    )
    if deleted:
        publish_job_change()
    return PruneCaptureJobHistoryResponse(deleted=deleted)


@router.get("/jobs/{job_id}")
def get_capture_job(
    job_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CaptureJob:
    """Return one durable job from the active vault."""
    job = capture_job_store(vm.active_vault_dir()).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Capture job not found: {job_id}")
    return job


@router.post("/jobs/{job_id}/retry")
@limiter.limit(WRITE_LIMIT)
async def retry_capture_job(
    request: Request,  # noqa: ARG001 — required by slowapi
    job_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CaptureJob:
    """Manually retry failed/review/cancelled work with a fresh attempt budget."""
    vault_root = vm.active_vault_dir().resolve()
    policy = _capture_processing_policy(vm)
    service = get_capture_job_service()
    try:
        async with service.operation_guard(vault_root):
            store = capture_job_store(vault_root)
            existing = await asyncio.to_thread(store.get, job_id)
            if existing is None:
                raise HTTPException(status_code=404, detail=f"Capture job not found: {job_id}")
            if not Path(existing.capture_path).exists():
                raise HTTPException(
                    status_code=409,
                    detail="Capture is no longer in the active Inbox",
                )
            retry_path = _resolve_inbox_capture(vm, existing.capture_path)
            retry_note = await asyncio.to_thread(parse_note, retry_path)
            if retry_note.id != existing.capture_id:
                raise HTTPException(
                    status_code=409,
                    detail="Capture file was replaced after this job was queued",
                )
            job = await asyncio.to_thread(store.retry, job_id, policy)
    except CaptureJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Capture job not found: {job_id}") from exc
    except (CaptureJobConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    publish_job_change()
    await _ensure_capture_worker(vm, policy, vault_root)
    service.notify(vault_root)
    return job


@router.post("/jobs/{job_id}/cancel")
@limiter.limit(WRITE_LIMIT)
async def cancel_capture_job(
    request: Request,  # noqa: ARG001 — required by slowapi
    job_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> CaptureJob:
    """Cancel a queued/retrying job without touching its Inbox capture."""
    vault_root = vm.active_vault_dir().resolve()
    service = get_capture_job_service()
    try:
        async with service.operation_guard(vault_root):
            store = capture_job_store(vault_root)
            job = await asyncio.to_thread(store.cancel, job_id)
    except CaptureJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Capture job not found: {job_id}") from exc
    except (CaptureJobConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    publish_job_change()
    return job


@router.post("/skip")
@limiter.limit(WRITE_LIMIT)
async def skip_capture(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: SkipCaptureRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> ProcessResult:
    """Persistently skip an Inbox item by moving it to the vault archive.

    Loom never hard-deletes notes. The capture is first rewritten through the
    validated ``vault_io`` chokepoint with archived status and a user history
    entry, then moved under ``threads/.archive/``.
    """
    capture_path = _resolve_inbox_capture(vm, body.capture_path)
    vault_root = _capture_vault_root(capture_path)
    threads_dir = vault_root / "threads"
    service = get_capture_job_service()

    from agents.file_locks import path_lock

    try:
        # Cancellation, archive IO, and index removal are one vault-bound
        # operation. Administrative handoff cannot rebind globals midway.
        async with service.operation_guard(vault_root):
            previous_job: CaptureJob | None = None
            cancelled_job: CaptureJob | None = None
            archive_committed = False
            try:
                _, previous_job, cancelled_job = await _cancel_pending_job_unlocked(
                    vault_root,
                    capture_path,
                    "Cancelled because the capture was skipped",
                )
                async with path_lock(capture_path):
                    if not capture_path.exists():
                        raise HTTPException(
                            status_code=404,
                            detail=f"Capture not found: {body.capture_path}",
                        )

                    try:
                        capture = parse_note(capture_path)
                    except (OSError, yaml.YAMLError, ValidationError, ValueError) as exc:
                        raise HTTPException(
                            status_code=400, detail="Capture is not a valid note"
                        ) from exc
                    if capture.type != "capture":
                        raise HTTPException(
                            status_code=400,
                            detail="Inbox item is not a capture note",
                        )

                    archive_dir = threads_dir / ".archive"
                    archive_dir.mkdir(parents=True, exist_ok=True)
                    try:
                        archive_dir.resolve().relative_to(threads_dir.resolve())
                    except ValueError as exc:
                        raise HTTPException(
                            status_code=400, detail="Vault archive path is unsafe"
                        ) from exc

                    ts = now_iso()
                    meta = capture.model_dump(exclude={"body", "wikilinks", "file_path"})
                    meta.update(
                        {
                            "status": "archived",
                            "modified": ts,
                            "enforcement_outcome": "skipped",
                            "review_required": False,
                            "review_reasons": [],
                        }
                    )
                    meta.setdefault("history", []).append(
                        {
                            "action": "skipped",
                            "by": "user",
                            "at": ts,
                            "reason": body.reason,
                        }
                    )
                    try:
                        vault_write_note(vault_root, capture_path, meta, capture.body)
                    except VaultIOError as exc:
                        raise HTTPException(status_code=400, detail=str(exc)) from exc

                    try:
                        destination = _unique_archive_path(
                            archive_dir, capture_path.name, capture.id
                        )
                        shutil.move(str(capture_path), str(destination))
                        archive_committed = True
                    except OSError as exc:
                        logger.warning("Failed to archive skipped capture", exc_info=True)
                        # Restore metadata if the move failed; otherwise the active
                        # file would misleadingly claim it had already been skipped.
                        original_meta = capture.model_dump(
                            exclude={"body", "wikilinks", "file_path"}
                        )
                        try:
                            vault_write_note(
                                vault_root,
                                capture_path,
                                original_meta,
                                capture.body,
                            )
                        except Exception:
                            logger.error(
                                "Failed to roll back skipped capture metadata",
                                exc_info=True,
                            )
                        raise HTTPException(
                            status_code=500, detail="Failed to archive capture"
                        ) from exc

                    index.remove_file(capture_path)
            except BaseException:
                if not archive_committed:
                    try:
                        await asyncio.shield(
                            _restore_cancelled_job_unlocked(vault_root, previous_job)
                        )
                    except Exception:
                        logger.exception(
                            "Failed to restore capture job after skip rollback"
                        )
                raise

            if cancelled_job is not None:
                publish_job_change()
            publish_capture_change()
            return ProcessResult(
                processed=False,
                outcome="skipped",
                target_path=str(destination),
                capture_archived=True,
            )
    except (CaptureJobConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


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
    capture_path = _resolve_inbox_capture(vm, body.capture_path)

    from agents.loom.weaver import get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )
    reservation = await _reserve_capture_job(vm, capture_path)

    from agents.runner import AgentRunner

    # Build the runner from the request's injected vault rather than the global
    # singleton: the singleton is for scheduled/background runs and may point at
    # a different active vault than this request's dependency-injected one.
    runner = AgentRunner(vm.active_vault_dir())
    capture_metadata_changed = False

    try:
        # Drive the LangGraph capture pipeline (Weaver → Spider → Scribe →
        # Sentinel with a Sentinel-retry loop). Passing index.refresh_file keeps
        # the search index hot after each write, matching the old inline path.
        result = await runner.run_pipeline(capture_path, refresh_index=index.refresh_file)
        response = _pipeline_result_to_process_result(result)
        if response.outcome == "failed":
            capture_metadata_changed = await asyncio.to_thread(
                _persist_failed_attempt,
                vm.active_vault_dir(),
                capture_path,
                response.error,
            )
    except asyncio.CancelledError:
        await asyncio.shield(
            _finish_reserved_job(
                reservation,
                JobExecutionResult(
                    status="failed",
                    outcome="failed",
                    error="Processing request cancelled",
                ),
            )
        )
        raise
    except Exception as exc:
        logger.warning("Capture processing failed", exc_info=True)
        capture_metadata_changed = await asyncio.to_thread(
            _persist_failed_attempt,
            vm.active_vault_dir(),
            capture_path,
            str(exc),
        )
        response = ProcessResult(processed=False, outcome="failed", error=str(exc))
    _publish_process_resource_changes(
        response,
        capture_metadata_changed=capture_metadata_changed,
    )
    await _finish_reserved_job(reservation, _job_execution_from_process_result(response))
    return response


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
        vm.active_vault_dir(),
        capture_path,
        note_path,
        validation_status,
        validation_reasons,
        validation_mode,
    )

    result_outcome: Literal["filed", "needs_review", "failed"]
    if outcome.review_required:
        result_outcome = "needs_review"
    elif outcome.capture_archived:
        result_outcome = "filed"
    else:
        result_outcome = "failed"

    return {
        "linked": linked,
        "suggested": suggested,
        "validation": validation_status,
        "validation_mode": validation_mode,
        "validation_reasons": validation_reasons,
        "capture_archived": outcome.capture_archived,
        "review_required": outcome.review_required,
        "flagged": outcome.flagged,
        "outcome": result_outcome,
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
    capture_path = _resolve_inbox_capture(vm, body.capture_path)

    from agents.loom.weaver import get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

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
    capture_path = _resolve_inbox_capture(vm, body.capture_path)

    from agents.loom.weaver import CaptureProposal, get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )
    reservation = await _reserve_capture_job(vm, capture_path)

    from agents.file_locks import path_lock
    from core.traces import clear_caller, set_caller

    try:
        async with path_lock(capture_path):
            # Re-validate existence under the same lock used by auto-processing.
            if not capture_path.exists():
                raise HTTPException(
                    status_code=404, detail=f"Capture not found: {body.capture_path}"
                )

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
                response = CommitResult(note=note, **outcome)
            finally:
                clear_caller()
    except asyncio.CancelledError:
        await asyncio.shield(
            _finish_reserved_job(
                reservation,
                JobExecutionResult(
                    status="failed",
                    outcome="failed",
                    error="Commit request cancelled",
                ),
            )
        )
        raise
    except Exception as exc:
        await _finish_reserved_job(
            reservation,
            JobExecutionResult(status="failed", outcome="failed", error=str(exc)),
        )
        raise

    job_result = JobExecutionResult(
        status=(
            "completed"
            if response.outcome == "filed"
            else "needs_review"
            if response.outcome == "needs_review"
            else "failed"
        ),
        outcome=response.outcome,
        error="; ".join(response.validation_reasons),
        note_id=response.note.id,
        note_title=response.note.title,
        note_type=response.note.type,
        target_path=response.note.file_path,
    )
    publish_capture_change()
    publish_note_change()
    await _finish_reserved_job(reservation, job_result)
    return response


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

    # Freeze background claims while coordinating the legacy bulk path. First
    # preflight *all* captures so one running job yields a clean 409, then mark
    # every row running before workers resume. Those durable reservations also
    # block active-vault handoff for the whole bulk operation.
    service_worker = get_capture_job_service().worker
    worker_paused = bool(
        service_worker is not None and service_worker.vault_root == vm.active_vault_dir().resolve()
    )
    if worker_paused:
        assert service_worker is not None
        await service_worker.pause_claims()
    reservations: dict[str, CaptureJob] = {}
    job_store = capture_job_store(vm.active_vault_dir())
    try:
        for capture_path in md_files:
            capture = parse_note(_resolve_inbox_capture(vm, str(capture_path)))
            existing = job_store.get_by_capture(capture.id)
            if existing is not None and existing.status == "running":
                raise HTTPException(
                    status_code=409,
                    detail=f"Capture is already being processed: {capture.title}",
                )
        try:
            for capture_path in md_files:
                reservations[str(capture_path)] = await _reserve_capture_job(vm, capture_path)
        except asyncio.CancelledError:
            await asyncio.shield(
                _fail_reserved_jobs(
                    list(reservations.values()),
                    "Bulk processing request cancelled during reservation",
                )
            )
            raise
        except Exception as exc:
            await _fail_reserved_jobs(list(reservations.values()), str(exc))
            raise
    finally:
        if worker_paused:
            assert service_worker is not None
            service_worker.resume_claims()

    from agents.runner import AgentRunner

    runner = AgentRunner(vm.active_vault_dir())
    results: list[ProcessResult] = []

    for index_in_batch, capture_path in enumerate(md_files):
        reservation = reservations[str(capture_path)]
        capture_metadata_changed = False
        try:
            _resolve_inbox_capture(vm, str(capture_path))
            result = await runner.run_pipeline(capture_path, refresh_index=index.refresh_file)
            response = _pipeline_result_to_process_result(result)
            if response.outcome == "failed":
                capture_metadata_changed = await asyncio.to_thread(
                    _persist_failed_attempt,
                    vm.active_vault_dir(),
                    capture_path,
                    response.error,
                )
        except asyncio.CancelledError:
            await asyncio.shield(
                asyncio.gather(
                    *(
                        _finish_reserved_job(
                            reservations[str(remaining)],
                            JobExecutionResult(
                                status="failed",
                                outcome="failed",
                                error="Bulk processing request cancelled",
                            ),
                        )
                        for remaining in md_files[index_in_batch:]
                    )
                )
            )
            raise
        except HTTPException as exc:
            response = ProcessResult(processed=False, outcome="failed", error=str(exc.detail))
        except Exception as exc:
            logger.warning("Capture processing failed for %s", capture_path, exc_info=True)
            capture_metadata_changed = await asyncio.to_thread(
                _persist_failed_attempt,
                vm.active_vault_dir(),
                capture_path,
                str(exc),
            )
            response = ProcessResult(processed=False, outcome="failed", error=str(exc))
        _publish_process_resource_changes(
            response,
            capture_metadata_changed=capture_metadata_changed,
        )
        await _finish_reserved_job(reservation, _job_execution_from_process_result(response))
        results.append(response)

    outcome_counts = {
        outcome: sum(1 for result in results if result.outcome == outcome)
        for outcome in ("filed", "needs_review", "skipped", "failed")
    }
    return ProcessAllResult(
        total=len(md_files),
        # ``processed`` remains for older clients and now means truly filed,
        # rather than "a draft note happened to be created".
        processed=outcome_counts["filed"],
        filed=outcome_counts["filed"],
        needs_review=outcome_counts["needs_review"],
        skipped=outcome_counts["skipped"],
        failed=outcome_counts["failed"],
        results=results,
    )

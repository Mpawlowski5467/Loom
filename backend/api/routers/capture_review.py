"""Human-approved capture merge endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agents.file_locks import path_lock
from core.capture_jobs import CaptureJob, JobExecutionResult
from core.capture_lifecycle import (
    CaptureLifecycleError,
    archive_capture,
    capture_vault_root,
    finish_reserved_job,
    reserve_capture_job,
    resolve_inbox_capture,
)
from core.capture_review import DuplicateEvidence, duplicate_evidence
from core.events import publish_capture_change, publish_note_change
from core.note_index import NoteIndex, get_note_index
from core.notes import is_published, matches_version, now_iso, parse_note
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager
from core.vault_io import write_note, write_text

router = APIRouter(prefix="/api/capture-review", tags=["capture-review"])


def _inbox_capture(vm: VaultManager, user_path: str) -> Path:
    """Map shared capture lifecycle errors to the route's HTTP contract."""
    try:
        return resolve_inbox_capture(vm, user_path)
    except CaptureLifecycleError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


async def _reserve(vm: VaultManager, capture_path: Path) -> CaptureJob:
    """Reserve a capture job with the same conflict response as Inbox routes."""
    try:
        return await reserve_capture_job(vm, capture_path)
    except CaptureLifecycleError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


class DuplicateRequest(BaseModel):
    capture_path: str


class DuplicateItem(BaseModel):
    note_id: str
    title: str
    score: float
    title_overlap: list[str]
    body_overlap: list[str]
    rationale: str


class MergeRequest(BaseModel):
    capture_path: str
    target_note_id: str
    body: str = Field(min_length=1, max_length=2_000_000)
    base_modified: str = Field(min_length=1)


@router.post("/duplicates", response_model=list[DuplicateItem])
async def duplicate_candidates(
    body: DuplicateRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> list[DuplicateItem]:
    """Return transparent, deterministic near-duplicate candidates."""
    capture = parse_note(_inbox_capture(vm, body.capture_path))
    rows: list[tuple[str, str, str]] = []
    for entry in index.all_entries():
        path = entry.file_path
        if path == Path(capture.file_path) or not path.exists():
            continue
        note = parse_note(path)
        if note.type != "capture" and note.status == "active":
            rows.append((note.id, note.title, note.body))
    matches = duplicate_evidence(
        capture_title=capture.title,
        capture_body=capture.body,
        notes=rows,
    )
    return [_evidence_item(match) for match in matches]


@router.post("/merge")
@limiter.limit(WRITE_LIMIT)
async def merge_capture(
    request: Request,  # noqa: ARG001
    body: MergeRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, str]:
    """Apply an explicitly approved body then archive its source capture.

    The target's version is checked while both paths are locked. A failed note
    write leaves the capture in the Inbox; only a completed mutation can make
    the source disappear.
    """
    capture_path = _inbox_capture(vm, body.capture_path)
    target_path = index.get_path_by_id(body.target_note_id)
    if target_path is None or not target_path.exists():
        raise HTTPException(status_code=404, detail="Target note not found")
    if target_path.resolve() == capture_path.resolve():
        raise HTTPException(status_code=400, detail="A capture cannot merge into itself")
    vault_root = capture_vault_root(capture_path)
    try:
        target_path.resolve().relative_to((vault_root / "threads").resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Target is outside the active vault") from exc
    reservation = await _reserve(vm, capture_path)
    try:
        first, second = sorted((capture_path, target_path), key=lambda path: str(path))
        async with path_lock(first), path_lock(second):
            if vm.active_vault_dir().resolve() != vault_root:
                raise HTTPException(
                    status_code=409, detail="Active vault changed; reload and retry."
                )
            capture = parse_note(capture_path)
            target = parse_note(target_path)
            if capture.type != "capture" or capture.status != "active":
                raise HTTPException(status_code=409, detail="Capture is no longer active")
            if (
                target.type == "capture"
                or target.status != "active"
                or not is_published(target)
                or target.id != body.target_note_id
            ):
                raise HTTPException(status_code=409, detail="Target is not an active note")
            if not matches_version(target, body.base_modified):
                raise HTTPException(
                    status_code=409, detail="Target note changed; reload and retry."
                )
            target_meta = target.model_dump(exclude={"body", "wikilinks", "file_path"})
            ts = now_iso()
            target_meta["modified"] = ts
            target_meta["history"].append(
                {
                    "action": "edited",
                    "by": "user",
                    "at": ts,
                    "reason": f"Merged capture {capture.id}",
                }
            )
            original_target = target_path.read_text(encoding="utf-8")
            write_note(vault_root, target_path, target_meta, body.body)
            try:
                archive_capture(
                    vault_root,
                    capture_path,
                    by="user",
                    reason=f"Merged into {target.id}",
                    lifecycle_fields={
                        "enforcement_outcome": "filed",
                        "review_required": False,
                        "review_reasons": [],
                    },
                )
            except Exception:
                write_text(vault_root, target_path, original_target)
                raise
            index.refresh_file(target_path)
            index.remove_file(capture_path)
    except Exception as exc:
        await finish_reserved_job(
            reservation, JobExecutionResult(status="failed", outcome="failed", error=str(exc))
        )
        if not isinstance(exc, HTTPException):
            raise HTTPException(
                status_code=500, detail="Merge failed; the capture was kept."
            ) from exc
        raise
    await finish_reserved_job(
        reservation,
        JobExecutionResult(
            status="completed",
            outcome="filed",
            note_id=body.target_note_id,
            note_title=target.title,
        ),
    )
    publish_note_change()
    publish_capture_change()
    return {"status": "merged", "note_id": body.target_note_id}


def _evidence_item(value: DuplicateEvidence) -> DuplicateItem:
    return DuplicateItem(
        note_id=value.note_id,
        title=value.title,
        score=value.score,
        title_overlap=list(value.title_overlap),
        body_overlap=list(value.body_overlap),
        rationale=value.rationale,
    )

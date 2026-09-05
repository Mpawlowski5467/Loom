"""Version history, explicit content restore, and complete AI-run undo."""

from contextlib import AsyncExitStack
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from agents.file_locks import path_lock
from core import revisions
from core.capture_jobs import CaptureJobConflictError, capture_job_store
from core.events import publish_capture_change, publish_capture_job_change, publish_note_change
from core.note_index import NoteIndex, get_note_index
from core.notes import note_to_file_content, now_iso, parse_note
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/revisions", tags=["revisions"])


class RestoreRequest(BaseModel):
    note_id: str
    version: Literal["before", "after"] = "before"
    expected_hash: str


class UndoRequest(BaseModel):
    expected_hashes: dict[str, str] = Field(default_factory=dict)


@router.get("")
@limiter.limit(READ_LIMIT)
def history(
    request: Request,
    note_id: str,
    limit: int = Query(50, ge=1, le=200),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[dict[str, Any]]:  # noqa: ARG001
    return revisions.list_revisions(vm.active_vault_dir(), note_id, limit)


@router.get("/runs/{run_id}")
@limiter.limit(READ_LIMIT)
def run_preview(
    request: Request,
    run_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> dict[str, Any]:  # noqa: ARG001
    try:
        root = vm.active_vault_dir()
        return revisions.preview(root, revisions.run_changes(root, run_id))
    except KeyError as exc:
        raise HTTPException(404, "No recoverable vault writes were recorded for this run") from exc
    except revisions.RevisionConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/runs/{run_id}/undo")
@limiter.limit(WRITE_LIMIT)
async def undo_run(
    request: Request,
    run_id: str,
    body: UndoRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, str]:  # noqa: ARG001
    root = vm.active_vault_dir()
    try:
        change = revisions.run_changes(root, run_id)
        async with AsyncExitStack() as stack:
            for relative in sorted(change["after"]):
                await stack.enter_async_context(path_lock(revisions._path(root, relative)))
            if vm.active_vault_dir() != root:
                raise revisions.RevisionConflict("The active vault changed; reload and retry.")
            store = capture_job_store(root)
            cancelled = []
            try:
                for relative, content in change["before"].items():
                    if relative.startswith("captures/") and content:
                        for capture_id in revisions._note_ids([content]):
                            snapshot, _ = store.cancel_by_capture_with_snapshot(
                                capture_id, "Source restored by undo; ready for manual review"
                            )
                            if snapshot:
                                cancelled.append(snapshot)
                revisions.undo(root, change, body.expected_hashes)
            except BaseException:
                for snapshot in reversed(cancelled):
                    store.restore_cancelled(snapshot)
                raise
        index.build(root / "threads")
        publish_note_change()
        publish_capture_change()
        publish_capture_job_change()
        return {"status": "undone"}
    except KeyError as exc:
        raise HTTPException(404, "No recoverable vault writes were recorded for this run") from exc
    except (revisions.RevisionConflict, CaptureJobConflictError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/{revision_id}")
@limiter.limit(READ_LIMIT)
def detail(
    request: Request,
    revision_id: str,
    note_id: str = "",
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, Any]:  # noqa: ARG001
    try:
        result = revisions.get_revision(vm.active_vault_dir(), revision_id)
        path = index.get_path_by_id(note_id) if note_id else None
        result["current_hash"] = revisions.fingerprint(
            path.read_text(encoding="utf-8") if path and path.exists() else None
        )
        return result
    except KeyError as exc:
        raise HTTPException(404, "Revision not found") from exc
    except revisions.RevisionConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/{revision_id}/restore")
@limiter.limit(WRITE_LIMIT)
async def restore_version(
    request: Request,
    revision_id: str,
    body: RestoreRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> Any:  # noqa: ARG001
    root = vm.active_vault_dir()
    path = index.get_path_by_id(body.note_id)
    if path is None or not path.exists():
        raise HTTPException(
            404, "Restore archived notes from the archive before restoring a revision"
        )
    try:
        revision = revisions.get_revision(root, revision_id)
        matches = [
            text
            for text in revision[body.version].values()
            if text is not None and body.note_id in revisions._note_ids([text])
        ]
        if len(matches) != 1:
            raise HTTPException(400, "This revision does not contain a unique version of this note")
        content = matches[0]
        # Restore content plus metadata, retaining an explicit audit entry and
        # fresh version so clients holding the older timestamp cannot overwrite it.
        import yaml

        parts = content.split("---", 2)
        meta = yaml.safe_load(parts[1])
        ts = now_iso()
        meta["modified"] = ts
        meta.setdefault("history", []).append(
            {
                "action": "restored",
                "by": "user",
                "at": ts,
                "reason": f"Restored {body.version} {revision_id}",
            }
        )
        restored = note_to_file_content(meta, parts[2].lstrip("\n"))
        async with path_lock(path):
            if vm.active_vault_dir() != root or not path.resolve().is_relative_to(
                (root / "threads").resolve()
            ):
                raise revisions.RevisionConflict("The active vault changed; reload and retry.")
            revisions.restore(root, path, restored, body.expected_hash)
        index.refresh_file(path)
        publish_note_change()
        return parse_note(path)
    except KeyError as exc:
        raise HTTPException(404, "Revision not found") from exc
    except revisions.RevisionConflict as exc:
        raise HTTPException(409, str(exc)) from exc

"""Git-backed vault history: browse commits, inspect diffs, revert (never rewrite)."""

import asyncio
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.history import get_history, unavailable_reason
from core.history.recorder import VaultHistory
from core.history.revert import RevertError, revert_commit
from core.history.views import diff_payload, entry_to_dict
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/history", tags=["history"])

_SHA_RE = re.compile(r"^[0-9a-fA-F]{4,40}$")
_NAME_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


def _recorder(vm: VaultManager) -> VaultHistory:
    root = vm.active_vault_dir()
    recorder = get_history(root)
    if recorder is None:
        raise HTTPException(503, unavailable_reason(root) or "Vault history is not running.")
    return recorder


def _check_sha(sha: str) -> str:
    if not _SHA_RE.match(sha):
        raise HTTPException(400, "Not a commit id")
    return sha


def _clean_path(path: str) -> str:
    cleaned = path.strip().lstrip("/")
    if not cleaned or "\\" in cleaned or ".." in cleaned.split("/"):
        raise HTTPException(400, "Path must be relative to the vault root")
    return cleaned


def _exact_line(key: str, value: str) -> str:
    if not _NAME_RE.match(value):
        raise HTTPException(400, f"Invalid {key.lower()} filter")
    # git --grep uses POSIX basic regex; of the allowed characters only "." is special.
    escaped = value.replace(".", r"\.")
    return f"^{key}: {escaped}$"


@router.get("/status")
@limiter.limit(READ_LIMIT)
def history_status(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> dict[str, Any]:
    """Whether history is recording for the active vault, and why not if it isn't."""
    root = vm.active_vault_dir()
    recorder = get_history(root)
    if recorder is None:
        return {
            "enabled": False,
            "reason": unavailable_reason(root) or "Vault history is not running.",
        }
    return {
        "enabled": True,
        "reason": "",
        "head": recorder.repo.head() if recorder.repo.is_repo() else None,
        "pending": len(recorder.pending_paths()),
        "human_debounce_seconds": recorder.config.human_debounce_seconds,
        "last_error": recorder.last_error,
    }


@router.get("")
@limiter.limit(READ_LIMIT)
async def list_history(
    request: Request,  # noqa: ARG001 — required by slowapi
    path: str | None = Query(None, description="Vault-relative path, e.g. threads/topics/raft.md"),
    agent: str | None = Query(None, description="Only commits with this Agent trailer"),
    group: str | None = Query(None, description="Only the commit for this Loom-Group id"),
    limit: int = Query(50, ge=1, le=200),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[dict[str, Any]]:
    """Commits newest-first, optionally for one note and/or one writer."""
    recorder = _recorder(vm)
    greps = []
    if agent:
        greps.append(_exact_line("Agent", agent))
    if group:
        greps.append(_exact_line("Loom-Group", group))
    target = _clean_path(path) if path else None
    entries = await asyncio.to_thread(recorder.repo.log, path=target, greps=greps, limit=limit)
    return [entry_to_dict(entry) for entry in entries]


@router.get("/{sha}/diff")
@limiter.limit(READ_LIMIT)
async def commit_diff(
    request: Request,  # noqa: ARG001 — required by slowapi
    sha: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> dict[str, Any]:
    """One commit's summary, per-file before/after text, and unified patch."""
    recorder = _recorder(vm)
    payload = await asyncio.to_thread(diff_payload, recorder.repo, _check_sha(sha))
    if payload is None:
        raise HTTPException(404, f"No history commit {sha}")
    return payload


@router.post("/{sha}/revert")
@limiter.limit(WRITE_LIMIT)
async def revert(
    request: Request,  # noqa: ARG001 — required by slowapi
    sha: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> dict[str, Any]:
    """Undo a commit with a new Sentinel-validated revert commit and reindex its notes."""
    recorder = _recorder(vm)
    try:
        return await revert_commit(recorder, _check_sha(sha))
    except RevertError as exc:
        raise HTTPException(exc.status, {"message": str(exc), "paths": exc.paths}) from exc

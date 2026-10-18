"""Shared, durable lifecycle operations for Inbox captures.

Routes and agents may choose different review policies, but reserving a job,
validating an active Inbox source, and archiving that source must have one
implementation. In particular, an archive failure must restore the exact
source bytes so a retry does not inherit an ``archived`` frontmatter state.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import yaml
from pydantic import ValidationError

from core.archive_paths import (
    ARCHIVE_ORIGINAL_PATH_FIELD,
    ArchivePathError,
    archive_directory,
    relative_existing_note_path,
)
from core.capture_jobs import (
    CaptureJob,
    CaptureJobConflictError,
    CaptureJobNotFoundError,
    CaptureJobsBusyError,
    JobExecutionResult,
    capture_job_store,
    get_capture_job_service,
    publish_job_change,
)
from core.config import CaptureProcessingConfig, GlobalConfig
from core.notes import generate_id, now_iso, parse_note
from core.revisions import record_move
from core.vault import VaultManager, VaultPathError
from core.vault_io import write_note, write_text

logger = logging.getLogger(__name__)


class CaptureLifecycleError(ValueError):
    """A user-visible capture lifecycle validation error."""

    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.status_code = status_code


class CaptureLifecycleConflict(CaptureLifecycleError):
    """A durable job is busy or no longer available for this operation."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail, status_code=409)


def resolve_inbox_capture(vm: VaultManager, user_path: str) -> Path:
    """Return a valid active capture path, never an arbitrary vault note."""
    try:
        capture_path = vm.resolve_capture_path(user_path)
    except VaultPathError as exc:
        raise CaptureLifecycleError(str(exc)) from exc

    captures_dir = (vm.active_threads_dir() / "captures").resolve()
    try:
        capture_path.relative_to(captures_dir)
    except ValueError as exc:
        raise CaptureLifecycleError(
            "Only notes in the active Inbox can be processed as captures"
        ) from exc

    if not capture_path.exists():
        raise CaptureLifecycleError(f"Capture not found: {user_path}", status_code=404)
    try:
        capture = parse_note(capture_path)
    except (OSError, yaml.YAMLError, ValidationError, ValueError) as exc:
        raise CaptureLifecycleError("Capture is not a valid note") from exc
    if capture.type != "capture":
        raise CaptureLifecycleError("Inbox item is not a capture note")
    return capture_path


def capture_vault_root(capture_path: Path) -> Path:
    """Recover the vault root from a validated ``threads/captures`` path."""
    for ancestor in capture_path.resolve().parents:
        if ancestor.name == "captures" and ancestor.parent.name == "threads":
            return ancestor.parent.parent
    raise CaptureLifecycleError("Capture path is not inside a vault Inbox")


def capture_processing_policy(vm: VaultManager) -> CaptureProcessingConfig:
    """Load processing policy from the request's active vault configuration."""
    return GlobalConfig.load(vm.config_path()).capture_processing


async def reserve_capture_job(vm: VaultManager, capture_path: Path) -> CaptureJob:
    """Claim the durable running row for a synchronous capture operation."""
    vault_root = capture_vault_root(capture_path)
    capture = await asyncio.to_thread(parse_note, capture_path)
    reservation_task = asyncio.create_task(
        get_capture_job_service().reserve_external(
            vault_root,
            capture_path,
            capture.id,
            capture.source,
            capture_processing_policy(vm),
        )
    )
    try:
        job = await asyncio.shield(reservation_task)
    except asyncio.CancelledError:
        try:
            orphaned = await reservation_task
        except BaseException:
            pass
        else:
            try:
                await asyncio.shield(
                    finish_reserved_job(
                        orphaned,
                        JobExecutionResult(
                            status="failed",
                            outcome="failed",
                            error="Processing request cancelled before execution",
                        ),
                    )
                )
            except Exception:
                logger.exception("Could not clean up cancelled capture reservation %s", orphaned.id)
        raise
    except (CaptureJobConflictError, CaptureJobsBusyError) as exc:
        raise CaptureLifecycleConflict(str(exc)) from exc
    publish_job_change()
    return job


async def finish_reserved_job(job: CaptureJob, result: JobExecutionResult) -> None:
    """Terminalize a caller-owned capture reservation without masking a failure."""
    vault_root = capture_vault_root(Path(job.capture_path))
    try:
        await asyncio.to_thread(capture_job_store(vault_root).finish, job.id, result)
    except (CaptureJobConflictError, CaptureJobNotFoundError):
        logger.error("Could not finalize capture job %s", job.id, exc_info=True)
        return
    publish_job_change()


def unique_archive_path(archive_dir: Path, filename: str, capture_id: str) -> Path:
    """Choose a collision-free archive name without replacing prior evidence."""
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


def archive_capture(
    vault_root: Path,
    capture_path: Path,
    *,
    by: str,
    reason: str,
    action: str = "archived",
    lifecycle_fields: dict[str, object] | None = None,
) -> Path:
    """Stamp and revision-archive a capture, restoring exact bytes on failure."""
    original = capture_path.read_text(encoding="utf-8")
    capture = parse_note(capture_path)
    if capture.type != "capture":
        raise CaptureLifecycleError("Inbox item is not a capture note")
    try:
        archive_dir = archive_directory(vault_root / "threads", create=True)
    except ArchivePathError as exc:
        raise CaptureLifecycleError(str(exc)) from exc
    if archive_dir is None:  # pragma: no cover - create=True always returns a path
        raise CaptureLifecycleError("Vault archive is unavailable")

    ts = now_iso()
    meta = capture.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta.update(lifecycle_fields or {})
    meta[ARCHIVE_ORIGINAL_PATH_FIELD] = relative_existing_note_path(
        vault_root / "threads", capture_path
    ).as_posix()
    meta.update({"status": "archived", "modified": ts})
    meta.setdefault("history", []).append({"action": action, "by": by, "at": ts, "reason": reason})
    destination = unique_archive_path(archive_dir, capture_path.name, capture.id)
    try:
        write_note(vault_root, capture_path, meta, capture.body)
        record_move(vault_root, capture_path, destination)
    except BaseException:
        try:
            if capture_path.exists():
                write_text(vault_root, capture_path, original)
        except Exception:
            logger.exception("Failed to restore capture after archive rollback: %s", capture_path)
        raise
    return destination

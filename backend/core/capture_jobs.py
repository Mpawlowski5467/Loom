"""Durable background processing for Inbox captures.

Jobs live in a small SQLite database inside each vault's ``.loom`` directory,
so queued work and terminal outcomes survive process restarts and vault
renames. Only the active vault has a running worker: Loom's agents are
process-global, and processing an inactive vault while those globals are being
rebound would risk cross-vault writes.

The worker deliberately remains a thin orchestration layer around
``AgentRunner.run_pipeline``. The runner's per-capture path lock and capture-id
deduplication continue to own transaction idempotency.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sqlite3
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal, cast
from uuid import uuid4

import yaml
from pydantic import BaseModel, ValidationError

from core.config import CaptureProcessingConfig
from core.events import (
    publish_capture_change,
    publish_capture_job_change,
    publish_note_change,
)
from core.notes import Note, parse_note

logger = logging.getLogger(__name__)

CaptureJobStatus = Literal[
    "queued",
    "running",
    "retrying",
    "needs_review",
    "failed",
    "completed",
    "cancelled",
]
CaptureJobOutcome = Literal["filed", "needs_review", "failed"]

_ACTIVE_STATUSES = ("queued", "running", "retrying")
_RETRYABLE_STATUSES = ("failed", "needs_review", "cancelled")
_DISCOVERY_INTERVAL_SECONDS = 2.0
_MAX_BACKOFF_SECONDS = 3600.0
_ACTIVE_WORKER_ROOTS: set[Path] = set()
_ACTIVE_WORKER_ROOTS_LOCK = threading.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _interrupted_transition(
    row: sqlite3.Row, now_iso: str
) -> tuple[CaptureJobStatus, CaptureJobOutcome | None, int, int, str]:
    """Crash-accounting for one interrupted ``running`` row.

    The claim that left the row ``running`` already consumed one attempt, so
    no counter is incremented here. Rows with budget left are requeued; rows
    at their bound are granted exactly one idempotent reconciliation claim —
    Loom may have died after archiving the capture but before finalizing the
    row, and the worker can infer that filed result from the missing source.
    The extension is persisted via ``recovery_extensions`` so repeated
    interruptions stay bounded; anything beyond it is a terminal failure.
    """
    attempts = int(row["attempts"])
    max_attempts = int(row["max_attempts"])
    extensions = int(row["recovery_extensions"])
    if attempts < max_attempts:
        return "retrying", None, max_attempts, extensions, ""
    if extensions == 0:
        return "retrying", None, attempts + 1, 1, ""
    return "failed", "failed", max_attempts, extensions, now_iso


class CaptureJob(BaseModel):
    """Public representation of one persisted capture-processing job."""

    id: str
    capture_id: str
    capture_path: str
    source: str = ""
    status: CaptureJobStatus
    outcome: CaptureJobOutcome | None = None
    attempts: int = 0
    max_attempts: int = 1
    next_attempt_at: str = ""
    error: str = ""
    note_id: str = ""
    note_title: str = ""
    note_type: str = ""
    target_path: str = ""
    created_at: str
    updated_at: str
    started_at: str = ""
    finished_at: str = ""


@dataclass(slots=True)
class JobExecutionResult:
    """Worker-facing pipeline result, independent of the HTTP response model."""

    status: Literal["completed", "needs_review", "failed"]
    outcome: CaptureJobOutcome
    error: str = ""
    transient: bool = False
    note_id: str = ""
    note_title: str = ""
    note_type: str = ""
    target_path: str = ""


@dataclass(slots=True)
class EnqueueResult:
    """Return value that distinguishes a new job from a deduplicated lookup."""

    job: CaptureJob
    created: bool


class CaptureJobNotFoundError(LookupError):
    """Raised when a requested job id does not exist in the active vault."""


class CaptureJobConflictError(RuntimeError):
    """Raised when a state transition is invalid for the current job state."""


class CaptureJobsBusyError(RuntimeError):
    """Raised when a vault switch is attempted while a pipeline is running."""


class CaptureJobStore:
    """SQLite-backed job repository scoped to one vault."""

    def __init__(self, vault_root: Path) -> None:
        self.vault_root = vault_root.resolve()
        loom_dir = self.vault_root / ".loom"
        loom_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = loom_dir / "capture-jobs.sqlite3"
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 30000")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = FULL")
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA user_version = 1")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS capture_jobs (
                    id TEXT PRIMARY KEY,
                    capture_id TEXT NOT NULL UNIQUE,
                    capture_path TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    outcome TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 1,
                    next_attempt_at TEXT NOT NULL,
                    error TEXT NOT NULL DEFAULT '',
                    note_id TEXT NOT NULL DEFAULT '',
                    note_title TEXT NOT NULL DEFAULT '',
                    note_type TEXT NOT NULL DEFAULT '',
                    target_path TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT NOT NULL DEFAULT '',
                    finished_at TEXT NOT NULL DEFAULT '',
                    recovery_extensions INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_capture_jobs_runnable
                    ON capture_jobs(status, next_attempt_at, created_at);
                CREATE INDEX IF NOT EXISTS idx_capture_jobs_updated
                    ON capture_jobs(updated_at DESC);
                """
            )
            columns = {
                str(row[1])
                for row in connection.execute("PRAGMA table_info(capture_jobs)").fetchall()
            }
            if "recovery_extensions" not in columns:
                connection.execute(
                    """
                    ALTER TABLE capture_jobs
                    ADD COLUMN recovery_extensions INTEGER NOT NULL DEFAULT 0
                    """
                )
            connection.execute("PRAGMA user_version = 2")

    def _stored_path(self, capture_path: Path) -> str:
        resolved = capture_path.resolve()
        captures_dir = (self.vault_root / "threads" / "captures").resolve()
        try:
            resolved.relative_to(captures_dir)
        except ValueError as exc:
            raise ValueError("Capture job path must be inside the active Inbox") from exc
        if resolved.suffix != ".md":
            raise ValueError("Capture job path must end in .md")
        return str(resolved.relative_to(self.vault_root))

    def _public_path(self, stored_path: str) -> str:
        path = Path(stored_path)
        if not path.is_absolute():
            path = self.vault_root / path
        return str(path.resolve())

    def _row_to_job(self, row: sqlite3.Row) -> CaptureJob:
        data = dict(row)
        data["capture_path"] = self._public_path(str(data["capture_path"]))
        return CaptureJob.model_validate(data)

    def enqueue(
        self,
        capture_path: Path,
        capture_id: str,
        source: str,
        policy: CaptureProcessingConfig,
        *,
        force: bool = False,
    ) -> EnqueueResult:
        """Create one job per stable capture id, or return the existing job.

        ``force`` resets terminal work to a fresh explicit attempt budget. It
        never duplicates or interrupts queued/running work.
        """
        stored_path = self._stored_path(capture_path)
        now = _iso()
        job_id = f"capjob_{uuid4().hex}"
        max_attempts = policy.max_retries + 1
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE capture_id = ?", (capture_id,)
            ).fetchone()
            if row is None:
                connection.execute(
                    """
                    INSERT INTO capture_jobs (
                        id, capture_id, capture_path, source, status, attempts,
                        max_attempts, next_attempt_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)
                    """,
                    (
                        job_id,
                        capture_id,
                        stored_path,
                        source,
                        max_attempts,
                        now,
                        now,
                        now,
                    ),
                )
                row = connection.execute(
                    "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
                ).fetchone()
                assert row is not None
                return EnqueueResult(job=self._row_to_job(row), created=True)

            status = cast(str, row["status"])
            if force and status not in _ACTIVE_STATUSES:
                connection.execute(
                    """
                    UPDATE capture_jobs
                       SET capture_path = ?, source = ?, status = 'queued',
                           outcome = NULL, attempts = 0, max_attempts = ?,
                           recovery_extensions = 0,
                           next_attempt_at = ?, error = '', note_id = '',
                           note_title = '', note_type = '', target_path = '',
                           updated_at = ?, started_at = '', finished_at = ''
                     WHERE id = ?
                    """,
                    (stored_path, source, max_attempts, now, now, row["id"]),
                )
            else:
                # Keep path/source current when a user renames a still-pending
                # capture, without reopening terminal work discovered on disk.
                connection.execute(
                    """
                    UPDATE capture_jobs
                       SET capture_path = ?, source = ?, updated_at = updated_at
                     WHERE id = ?
                    """,
                    (stored_path, source, row["id"]),
                )
            fresh = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (row["id"],)
            ).fetchone()
            assert fresh is not None
            return EnqueueResult(job=self._row_to_job(fresh), created=False)

    def get(self, job_id: str) -> CaptureJob | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
            ).fetchone()
        return self._row_to_job(row) if row is not None else None

    def get_by_capture(self, capture_id: str) -> CaptureJob | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE capture_id = ?", (capture_id,)
            ).fetchone()
        return self._row_to_job(row) if row is not None else None

    def list_jobs(
        self, *, status: CaptureJobStatus | None = None, limit: int = 200
    ) -> list[CaptureJob]:
        """Return active jobs first, followed by the most recent terminals."""
        with self._connect() as connection:
            if status is not None:
                rows = connection.execute(
                    """
                    SELECT * FROM capture_jobs
                     WHERE status = ?
                     ORDER BY updated_at DESC
                     LIMIT ?
                    """,
                    (status, limit),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT * FROM capture_jobs
                     ORDER BY CASE
                         WHEN status IN ('queued', 'running', 'retrying') THEN 0
                         ELSE 1
                     END, updated_at DESC
                     LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
        return [self._row_to_job(row) for row in rows]

    def prune_history(self, *, before: datetime | None = None) -> int:
        """Delete non-actionable terminal history, optionally before a cutoff.

        Failed and needs-review rows are deliberately retained: they remain
        actionable and carry the attempt/error evidence needed for a safe
        retry. Only completed and cancelled rows belong to the history view.
        """
        with self._connect() as connection:
            if before is None:
                cursor = connection.execute(
                    """
                    DELETE FROM capture_jobs
                     WHERE status IN ('completed', 'cancelled')
                    """
                )
            else:
                cursor = connection.execute(
                    """
                    DELETE FROM capture_jobs
                     WHERE status IN ('completed', 'cancelled')
                       AND CASE
                           WHEN finished_at != '' THEN finished_at
                           ELSE updated_at
                       END < ?
                    """,
                    (_iso(before),),
                )
            return max(cursor.rowcount, 0)

    def claim_next(self) -> CaptureJob | None:
        """Atomically claim the next due queued/retrying job."""
        now = _iso()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT * FROM capture_jobs
                 WHERE status IN ('queued', 'retrying')
                   AND next_attempt_at <= ?
                 ORDER BY next_attempt_at, created_at
                 LIMIT 1
                """,
                (now,),
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                """
                UPDATE capture_jobs
                   SET status = 'running', attempts = attempts + 1,
                       updated_at = ?, started_at = ?, finished_at = ''
                 WHERE id = ? AND status IN ('queued', 'retrying')
                """,
                (now, now, row["id"]),
            )
            claimed = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (row["id"],)
            ).fetchone()
            assert claimed is not None
            return self._row_to_job(claimed)

    def finish(self, job_id: str, result: JobExecutionResult) -> CaptureJob:
        now = _iso()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE capture_jobs
                   SET status = ?, outcome = ?, error = ?, note_id = ?,
                       note_title = ?, note_type = ?, target_path = ?,
                       updated_at = ?, finished_at = ?, next_attempt_at = ?
                 WHERE id = ? AND status = 'running'
                """,
                (
                    result.status,
                    result.outcome,
                    result.error,
                    result.note_id,
                    result.note_title,
                    result.note_type,
                    result.target_path,
                    now,
                    now,
                    now,
                    job_id,
                ),
            )
            if cursor.rowcount != 1:
                raise CaptureJobConflictError("Job is no longer running")
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            assert row is not None
            return self._row_to_job(row)

    def fail_or_retry(
        self,
        job_id: str,
        *,
        error: str,
        transient: bool,
        base_backoff_seconds: float,
    ) -> CaptureJob:
        """Schedule bounded exponential backoff or record a terminal failure."""
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row is None:
                raise CaptureJobNotFoundError(job_id)
            if row["status"] != "running":
                raise CaptureJobConflictError("Job is no longer running")
            attempts = int(row["attempts"])
            max_attempts = int(row["max_attempts"])
            now_dt = _now()
            if transient and attempts < max_attempts:
                delay = min(
                    base_backoff_seconds * (2 ** max(attempts - 1, 0)),
                    _MAX_BACKOFF_SECONDS,
                )
                status: CaptureJobStatus = "retrying"
                outcome: CaptureJobOutcome | None = None
                next_attempt_at = _iso(now_dt + timedelta(seconds=delay))
                finished_at = ""
            else:
                status = "failed"
                outcome = "failed"
                next_attempt_at = _iso(now_dt)
                finished_at = _iso(now_dt)
            connection.execute(
                """
                UPDATE capture_jobs
                   SET status = ?, outcome = ?, error = ?, updated_at = ?,
                       next_attempt_at = ?, finished_at = ?
                 WHERE id = ?
                """,
                (
                    status,
                    outcome,
                    error,
                    _iso(now_dt),
                    next_attempt_at,
                    finished_at,
                    job_id,
                ),
            )
            fresh = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            assert fresh is not None
            return self._row_to_job(fresh)

    def retry(self, job_id: str, policy: CaptureProcessingConfig) -> CaptureJob:
        """Give a terminal job a fresh, explicit attempt budget."""
        now = _iso()
        placeholders = ",".join("?" for _ in _RETRYABLE_STATUSES)
        with self._connect() as connection:
            cursor = connection.execute(
                f"""
                UPDATE capture_jobs
                   SET status = 'queued', outcome = NULL, attempts = 0,
                       max_attempts = ?, recovery_extensions = 0,
                       next_attempt_at = ?, error = '',
                       note_id = '', note_title = '', note_type = '',
                       target_path = '', updated_at = ?, started_at = '',
                       finished_at = ''
                 WHERE id = ? AND status IN ({placeholders})
                """,
                (
                    policy.max_retries + 1,
                    now,
                    now,
                    job_id,
                    *_RETRYABLE_STATUSES,
                ),
            )
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row is None:
                raise CaptureJobNotFoundError(job_id)
            if cursor.rowcount != 1:
                raise CaptureJobConflictError(
                    f"Only terminal failed, review, or cancelled jobs can retry (is {row['status']})"
                )
            return self._row_to_job(row)

    def cancel(
        self,
        job_id: str,
        *,
        stale_after_seconds: float | None = None,
        now: datetime | None = None,
    ) -> CaptureJob:
        """Cancel work that has not started; running pipelines are immutable.

        The single exception is a ``running`` row that is provably stale:
        when ``stale_after_seconds`` is given, a row with no liveness past
        that cutoff has lost its executor and may be cancelled like pending
        work. Fresh running rows keep their conflict — a live worker owns
        them.
        """
        now_dt = now or _now()
        now_iso = _iso(now_dt)
        with self._connect() as connection:
            if stale_after_seconds is None:
                cursor = connection.execute(
                    """
                    UPDATE capture_jobs
                       SET status = 'cancelled', outcome = NULL,
                           error = 'Cancelled by user', updated_at = ?,
                           finished_at = ?, next_attempt_at = ?
                     WHERE id = ? AND status IN ('queued', 'retrying')
                    """,
                    (now_iso, now_iso, now_iso, job_id),
                )
            else:
                cutoff = _iso(now_dt - timedelta(seconds=stale_after_seconds))
                cursor = connection.execute(
                    """
                    UPDATE capture_jobs
                       SET status = 'cancelled', outcome = NULL,
                           error = 'Cancelled by user', updated_at = ?,
                           finished_at = ?, next_attempt_at = ?
                     WHERE id = ?
                       AND (
                           status IN ('queued', 'retrying')
                           OR (
                               status = 'running'
                               AND CASE
                                   WHEN started_at != '' THEN started_at
                                   ELSE updated_at
                               END < ?
                           )
                       )
                    """,
                    (now_iso, now_iso, now_iso, job_id, cutoff),
                )
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row is None:
                raise CaptureJobNotFoundError(job_id)
            if cursor.rowcount != 1:
                raise CaptureJobConflictError(
                    f"Only queued or retrying jobs can be cancelled (is {row['status']})"
                )
            return self._row_to_job(row)

    def cancel_by_capture(self, capture_id: str, reason: str) -> CaptureJob | None:
        """Cancel pending work for a capture before a synchronous operation."""
        _, cancelled = self.cancel_by_capture_with_snapshot(capture_id, reason)
        return cancelled

    def cancel_by_capture_with_snapshot(
        self, capture_id: str, reason: str
    ) -> tuple[CaptureJob | None, CaptureJob | None]:
        """Cancel pending work and atomically return its prior durable state."""
        now = _iso()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE capture_id = ?", (capture_id,)
            ).fetchone()
            if row is None:
                return None, None
            previous = self._row_to_job(row)
            if row["status"] == "running":
                raise CaptureJobConflictError("Capture is already being processed")
            cursor = connection.execute(
                """
                UPDATE capture_jobs
                   SET status = 'cancelled', outcome = NULL, error = ?,
                       updated_at = ?, finished_at = ?, next_attempt_at = ?
                 WHERE id = ? AND status != 'running'
                """,
                (reason, now, now, now, row["id"]),
            )
            if cursor.rowcount != 1:
                raise CaptureJobConflictError("Capture is already being processed")
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (row["id"],)
            ).fetchone()
            assert row is not None
            return previous, self._row_to_job(row)

    def restore_cancelled(self, snapshot: CaptureJob) -> CaptureJob:
        """Restore an exact pre-cancellation state after a filesystem rollback.

        This is deliberately compare-and-swap guarded: only the cancellation
        performed by the surrounding operation may be compensated. A running
        or otherwise reopened row is never overwritten.
        """
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE capture_jobs
                   SET capture_path = ?, source = ?, status = ?, outcome = ?,
                       attempts = ?, max_attempts = ?, next_attempt_at = ?,
                       error = ?, note_id = ?, note_title = ?, note_type = ?,
                       target_path = ?, updated_at = ?, started_at = ?,
                       finished_at = ?
                 WHERE id = ? AND capture_id = ? AND status = 'cancelled'
                """,
                (
                    snapshot.capture_path,
                    snapshot.source,
                    snapshot.status,
                    snapshot.outcome,
                    snapshot.attempts,
                    snapshot.max_attempts,
                    snapshot.next_attempt_at,
                    snapshot.error,
                    snapshot.note_id,
                    snapshot.note_title,
                    snapshot.note_type,
                    snapshot.target_path,
                    snapshot.updated_at,
                    snapshot.started_at,
                    snapshot.finished_at,
                    snapshot.id,
                    snapshot.capture_id,
                ),
            )
            if cursor.rowcount != 1:
                raise CaptureJobConflictError(
                    "Cancelled capture job changed before it could be restored"
                )
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (snapshot.id,)
            ).fetchone()
            assert row is not None
            return self._row_to_job(row)

    def reserve_external(
        self,
        capture_path: Path,
        capture_id: str,
        source: str,
        policy: CaptureProcessingConfig,
    ) -> CaptureJob:
        """Atomically reserve a capture for a legacy synchronous pipeline.

        The durable ``running`` row makes worker claims, retries, and active
        vault switches observe the in-flight operation just like background
        work. A crash is recovered by the normal startup recovery path.

        ``attempts`` deliberately counts worker claims only — it is the
        background retry budget that :meth:`fail_or_retry` and
        :meth:`recover_interrupted` compare against ``max_attempts``. A
        synchronous reservation must not consume that budget: each manual
        ``/process`` call would otherwise inflate the counter and a later
        background retry could go terminal on its first transient failure
        with zero backoff retries.
        """
        stored_path = self._stored_path(capture_path)
        now = _iso()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE capture_id = ?", (capture_id,)
            ).fetchone()
            if row is None:
                job_id = f"capjob_{uuid4().hex}"
                connection.execute(
                    """
                    INSERT INTO capture_jobs (
                        id, capture_id, capture_path, source, status, attempts,
                        max_attempts, next_attempt_at, created_at, updated_at,
                        started_at
                    ) VALUES (?, ?, ?, ?, 'running', 0, ?, ?, ?, ?, ?)
                    """,
                    (
                        job_id,
                        capture_id,
                        stored_path,
                        source,
                        policy.max_retries + 1,
                        now,
                        now,
                        now,
                        now,
                    ),
                )
                reserved = connection.execute(
                    "SELECT * FROM capture_jobs WHERE id = ?", (job_id,)
                ).fetchone()
                assert reserved is not None
                return self._row_to_job(reserved)
            if row["status"] == "running":
                raise CaptureJobConflictError("Capture is already being processed")
            cursor = connection.execute(
                """
                UPDATE capture_jobs
                   SET capture_path = ?, source = ?, status = 'running',
                       outcome = NULL, max_attempts = ?,
                       recovery_extensions = 0,
                       next_attempt_at = ?, error = '',
                       note_id = '', note_title = '', note_type = '',
                       target_path = '', updated_at = ?, started_at = ?,
                       finished_at = ''
                 WHERE id = ? AND status != 'running'
                """,
                (
                    stored_path,
                    source,
                    policy.max_retries + 1,
                    now,
                    now,
                    now,
                    row["id"],
                ),
            )
            if cursor.rowcount != 1:
                raise CaptureJobConflictError("Capture is already being processed")
            reserved = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (row["id"],)
            ).fetchone()
            assert reserved is not None
            return self._row_to_job(reserved)

    def reconcile_external_result(
        self, capture_id: str, result: JobExecutionResult
    ) -> CaptureJob | None:
        """Reflect a synchronous process/commit result on an existing job."""
        now = _iso()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM capture_jobs WHERE capture_id = ?", (capture_id,)
            ).fetchone()
            if row is None:
                return None
            if row["status"] == "running":
                raise CaptureJobConflictError("Capture is already being processed")
            cursor = connection.execute(
                """
                UPDATE capture_jobs
                   SET status = ?, outcome = ?, error = ?, note_id = ?,
                       note_title = ?, note_type = ?, target_path = ?,
                       updated_at = ?, finished_at = ?, next_attempt_at = ?
                 WHERE id = ? AND status != 'running'
                """,
                (
                    result.status,
                    result.outcome,
                    result.error,
                    result.note_id,
                    result.note_title,
                    result.note_type,
                    result.target_path,
                    now,
                    now,
                    now,
                    row["id"],
                ),
            )
            if cursor.rowcount != 1:
                raise CaptureJobConflictError("Capture is already being processed")
            fresh = connection.execute(
                "SELECT * FROM capture_jobs WHERE id = ?", (row["id"],)
            ).fetchone()
            assert fresh is not None
            return self._row_to_job(fresh)

    def mark_missing(self, job_id: str, *, filed: bool) -> CaptureJob:
        """Terminalize a claimed job whose active capture disappeared."""
        result = JobExecutionResult(
            status="completed" if filed else "failed",
            outcome="filed" if filed else "failed",
            error="" if filed else "Capture is no longer present in the active Inbox",
        )
        return self.finish(job_id, result)

    def recover_interrupted(self) -> list[CaptureJob]:
        """Move jobs left ``running`` by a crash back to retry/failure."""
        now = _iso()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            running = connection.execute(
                "SELECT * FROM capture_jobs WHERE status = 'running'"
            ).fetchall()
            recovered_ids: list[str] = []
            for row in running:
                status, outcome, max_attempts, extensions, finished_at = _interrupted_transition(
                    row, now
                )
                connection.execute(
                    """
                    UPDATE capture_jobs
                       SET status = ?, outcome = ?, max_attempts = ?,
                           recovery_extensions = ?,
                           error = 'Interrupted by process restart',
                           next_attempt_at = ?, updated_at = ?, finished_at = ?
                     WHERE id = ?
                    """,
                    (
                        status,
                        outcome,
                        max_attempts,
                        extensions,
                        now,
                        now,
                        finished_at,
                        row["id"],
                    ),
                )
                recovered_ids.append(str(row["id"]))
            if not recovered_ids:
                return []
            placeholders = ",".join("?" for _ in recovered_ids)
            rows = connection.execute(
                f"SELECT * FROM capture_jobs WHERE id IN ({placeholders})",
                recovered_ids,
            ).fetchall()
            return [self._row_to_job(row) for row in rows]

    def reclaim_stale_running(
        self,
        *,
        stale_after_seconds: float,
        now: datetime | None = None,
    ) -> list[CaptureJob]:
        """Requeue or fail ``running`` rows whose executor is provably gone.

        A ``running`` row is stale when its liveness timestamp — the claim's
        ``started_at``, falling back to ``updated_at`` — is older than the
        cutoff. Rows are transitioned with the same attempt accounting a
        crash gets in :meth:`recover_interrupted`: requeued while budget
        remains, granted one bounded reconciliation claim at the bound, and
        failed beyond it. The compare-and-swap guard lets a live worker that
        finishes the same row concurrently win; queued, retrying, and
        terminal rows are never touched.
        """
        now_dt = now or _now()
        now_iso = _iso(now_dt)
        cutoff = _iso(now_dt - timedelta(seconds=stale_after_seconds))
        error = f"Stale running job reclaimed (no liveness for {int(stale_after_seconds)}s)"
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            running = connection.execute(
                """
                SELECT * FROM capture_jobs
                 WHERE status = 'running'
                   AND CASE
                       WHEN started_at != '' THEN started_at
                       ELSE updated_at
                   END < ?
                """,
                (cutoff,),
            ).fetchall()
            reclaimed_ids: list[str] = []
            for row in running:
                status, outcome, max_attempts, extensions, finished_at = _interrupted_transition(
                    row, now_iso
                )
                cursor = connection.execute(
                    """
                    UPDATE capture_jobs
                       SET status = ?, outcome = ?, max_attempts = ?,
                           recovery_extensions = ?, error = ?,
                           next_attempt_at = ?, updated_at = ?, finished_at = ?
                     WHERE id = ? AND status = 'running'
                    """,
                    (
                        status,
                        outcome,
                        max_attempts,
                        extensions,
                        error,
                        now_iso,
                        now_iso,
                        finished_at,
                        row["id"],
                    ),
                )
                if cursor.rowcount != 1:
                    # A live executor finalized the row first; its outcome wins.
                    continue
                reclaimed_ids.append(str(row["id"]))
            if not reclaimed_ids:
                return []
            placeholders = ",".join("?" for _ in reclaimed_ids)
            fresh_rows = connection.execute(
                f"SELECT * FROM capture_jobs WHERE id IN ({placeholders})",
                reclaimed_ids,
            ).fetchall()
            return [self._row_to_job(row) for row in fresh_rows]

    def has_running(self) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM capture_jobs WHERE status = 'running' LIMIT 1"
            ).fetchone()
        return row is not None


def _terminal_capture_marker(note: Note) -> bool:
    """Avoid rediscovering work already terminalized outside this database."""
    extra = note.extra
    return bool(
        extra.get("review_required") is True
        or extra.get("enforcement_outcome") in {"filed", "needs_review", "skipped", "failed"}
        or extra.get("processing_status") in {"completed", "needs_review", "failed", "cancelled"}
    )


def _looks_transient(error: str, exc: BaseException | None = None) -> bool:
    """Conservatively identify infrastructure failures worth retrying.

    Provider clients already perform their own HTTP retries. This layer only
    retries errors that clearly look transient or local IO/archive contention;
    empty/invalid captures and missing agent/provider configuration terminate.
    """
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        return True
    lowered = error.lower()
    non_retryable = (
        "not initialized",
        "not configured",
        "invalid api key",
        "unauthorized",
        "forbidden",
        "empty capture",
        "invalid capture",
        "read chain failed",
    )
    if any(marker in lowered for marker in non_retryable):
        return False
    transient = (
        "timeout",
        "timed out",
        "rate limit",
        "429",
        "connection",
        "temporar",
        "service unavailable",
        "network",
        "reset by peer",
        "refused",
        "i/o",
        "ioerror",
        "database is locked",
        "could not be archived",
        "archive failed",
    )
    return any(marker in lowered for marker in transient)


async def _default_processor(vault_root: Path, capture_path: Path) -> JobExecutionResult:
    """Run the existing idempotent capture pipeline and classify its outcome."""
    from agents.runner import AgentRunner
    from core.note_index import get_note_index

    runner = AgentRunner(vault_root)
    try:
        result = await runner.run_pipeline(
            capture_path, refresh_index=get_note_index().refresh_file
        )
    except Exception as exc:  # noqa: BLE001 - converted to durable job state
        return JobExecutionResult(
            status="failed",
            outcome="failed",
            error=str(exc) or exc.__class__.__name__,
            transient=_looks_transient(str(exc), exc),
        )

    # The pipeline can mutate two resource domains independently of its job
    # row. Publish those scoped signals here; the worker's state transition
    # below remains a capture-job-only event.
    if result.note is not None:
        publish_note_change()
        publish_capture_change()
    elif result.capture_archived or result.review_required or result.flagged:
        publish_capture_change()

    note = result.note
    error = "; ".join(result.errors)
    if result.review_required:
        if not error and result.validation is not None:
            error = "; ".join(result.validation.reasons)
        return JobExecutionResult(
            status="needs_review",
            outcome="needs_review",
            error=error,
            note_id=note.id if note else "",
            note_title=note.title if note else "",
            note_type=note.type if note else "",
            target_path=note.file_path if note else "",
        )
    if result.capture_archived and note is not None:
        return JobExecutionResult(
            status="completed",
            outcome="filed",
            error=error,
            note_id=note.id,
            note_title=note.title,
            note_type=note.type,
            target_path=note.file_path,
        )

    if not error:
        error = (
            "Empty capture cannot be processed"
            if note is None
            else "Capture pipeline did not archive its source"
        )
    return JobExecutionResult(
        status="failed",
        outcome="failed",
        error=error,
        transient=_looks_transient(error),
        note_id=note.id if note else "",
        note_title=note.title if note else "",
        note_type=note.type if note else "",
        target_path=note.file_path if note else "",
    )


class CaptureJobWorker:
    """Bounded async worker pool plus safe capture discovery loop."""

    def __init__(
        self,
        vault_root: Path,
        policy: CaptureProcessingConfig,
        *,
        processor: Callable[[Path], Awaitable[JobExecutionResult]] | None = None,
        discovery_interval: float = _DISCOVERY_INTERVAL_SECONDS,
    ) -> None:
        self.vault_root = vault_root.resolve()
        self.store = CaptureJobStore(self.vault_root)
        self.policy = policy.model_copy(deep=True)
        self._processor = processor or (lambda path: _default_processor(self.vault_root, path))
        self._discovery_interval = discovery_interval
        self._wake = asyncio.Event()
        self._stop = asyncio.Event()
        self._claim_lock = asyncio.Lock()
        self._accepting = True
        self._tasks: dict[int, asyncio.Task[None]] = {}
        self._discovery_task: asyncio.Task[None] | None = None
        self._process_lease_acquired = False

    @property
    def running(self) -> bool:
        return any(not task.done() for task in self._tasks.values()) and not self._stop.is_set()

    async def start(self) -> None:
        if self.running:
            return
        self._acquire_process_lease()
        try:
            self._stop.clear()
            self._accepting = True
            recovered = await asyncio.to_thread(self.store.recover_interrupted)
            # Safety net alongside crash recovery: rows that stranded long
            # enough ago are reclaimed even if a future recovery path ever
            # leaves them running.
            reclaimed = await asyncio.to_thread(
                self.store.reclaim_stale_running,
                stale_after_seconds=self.policy.stale_running_seconds,
            )
            if recovered or reclaimed:
                self._publish_change()
            await self.reconcile()
            self._tasks = {
                index: asyncio.create_task(self._run_worker(index), name=f"capture-worker-{index}")
                for index in range(self.policy.concurrency)
            }
            self._discovery_task = asyncio.create_task(
                self._run_discovery(), name="capture-job-discovery"
            )
            self._wake.set()
        except BaseException:
            self._release_process_lease()
            raise

    def _acquire_process_lease(self) -> None:
        """Prevent two in-process workers from recovering the same live rows."""
        if self._process_lease_acquired:
            return
        with _ACTIVE_WORKER_ROOTS_LOCK:
            if self.vault_root in _ACTIVE_WORKER_ROOTS:
                raise CaptureJobsBusyError("A capture worker is already active for this vault")
            _ACTIVE_WORKER_ROOTS.add(self.vault_root)
            self._process_lease_acquired = True

    def _release_process_lease(self) -> None:
        if not self._process_lease_acquired:
            return
        with _ACTIVE_WORKER_ROOTS_LOCK:
            _ACTIVE_WORKER_ROOTS.discard(self.vault_root)
            self._process_lease_acquired = False

    async def update_policy(self, policy: CaptureProcessingConfig) -> None:
        """Apply policy changes without interrupting an in-flight pipeline."""
        self.policy = policy.model_copy(deep=True)
        self._tasks = {index: task for index, task in self._tasks.items() if not task.done()}
        if not self._stop.is_set():
            for index in range(policy.concurrency):
                if index in self._tasks:
                    continue
                self._tasks[index] = asyncio.create_task(
                    self._run_worker(index), name=f"capture-worker-{index}"
                )
        self._wake.set()
        await self.reconcile()

    async def pause_claims(self) -> None:
        """Close the claim race before checking whether a vault can switch."""
        async with self._claim_lock:
            self._accepting = False

    def resume_claims(self) -> None:
        self._accepting = True
        self._wake.set()

    async def aclose(self, *, drain: bool = False) -> None:
        """Stop polling; cancelled running rows are recovered on next startup."""
        try:
            self._accepting = False
            self._stop.set()
            self._wake.set()
            # Discovery may be awaiting ``to_thread(parse/write/sqlite)``.
            # Cancelling its coroutine would not stop that underlying thread,
            # which could then touch a vault after it was renamed/deleted.
            # Signal stop and drain it before filesystem mutation.
            if self._discovery_task is not None:
                await asyncio.gather(self._discovery_task, return_exceptions=True)
            tasks = list(self._tasks.values())
            if not drain:
                for task in tasks:
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            self._tasks.clear()
            self._discovery_task = None
        finally:
            self._release_process_lease()

    def notify(self) -> None:
        self._wake.set()

    async def reconcile(self) -> int:
        """Discover captures written by agents, bridges, or direct filesystem IO."""
        if self.policy.mode == "manual":
            return 0
        captures_dir = self.vault_root / "threads" / "captures"
        if not captures_dir.exists():
            return 0
        created = 0
        for capture_path in sorted(captures_dir.glob("*.md")):
            try:
                note = await asyncio.to_thread(parse_note, capture_path)
            except (OSError, yaml.YAMLError, ValidationError, ValueError):
                continue
            if (
                note.type != "capture"
                or note.status != "active"
                or _terminal_capture_marker(note)
                or not self.policy.permits(note.source)
            ):
                continue
            result = await asyncio.to_thread(
                self.store.enqueue,
                capture_path,
                note.id,
                note.source,
                self.policy,
            )
            if result.created:
                created += 1
        if created:
            self._publish_change()
            self._wake.set()
        return created

    async def _run_discovery(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._discovery_interval)
            except TimeoutError:
                try:
                    await self.reconcile()
                except Exception:  # noqa: BLE001 - discovery must self-heal
                    logger.warning("Capture job discovery failed", exc_info=True)

    async def _claim(self, worker_index: int) -> CaptureJob | None:
        async with self._claim_lock:
            if (
                not self._accepting
                or self._stop.is_set()
                or worker_index >= self.policy.concurrency
            ):
                return None
            return await asyncio.to_thread(self.store.claim_next)

    async def _run_worker(self, worker_index: int) -> None:
        while not self._stop.is_set():
            if worker_index >= self.policy.concurrency:
                return
            try:
                job = await self._claim(worker_index)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - SQLite contention must self-heal
                logger.warning("Capture worker claim failed", exc_info=True)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop.wait(), timeout=0.5)
                continue
            if job is None:
                self._wake.clear()
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), timeout=0.5)
                continue
            self._publish_change()
            capture_path = Path(job.capture_path)
            try:
                await self._execute(job, capture_path)
            except asyncio.CancelledError:
                # Leave the durable row running. Startup recovery decides
                # retrying vs failed from its persisted attempt budget.
                raise
            except Exception as exc:  # noqa: BLE001 - one job cannot kill a worker
                logger.exception("Unexpected capture worker failure for %s", job.id)
                try:
                    await asyncio.to_thread(
                        self.store.fail_or_retry,
                        job.id,
                        error=str(exc) or "Unexpected capture worker failure",
                        transient=True,
                        base_backoff_seconds=self.policy.base_backoff_seconds,
                    )
                    self._publish_change()
                except Exception:  # noqa: BLE001 - recovery is best-effort
                    logger.warning("Could not persist worker recovery state", exc_info=True)

    async def _execute(self, job: CaptureJob, capture_path: Path) -> None:
        if not capture_path.exists():
            filed = await asyncio.to_thread(self._has_filed_note, job.capture_id)
            await asyncio.to_thread(self.store.mark_missing, job.id, filed=filed)
            self._publish_change()
            return

        identity_error = await asyncio.to_thread(self._capture_identity_error, job, capture_path)
        if identity_error:
            await asyncio.to_thread(
                self.store.finish,
                job.id,
                JobExecutionResult(
                    status="failed",
                    outcome="failed",
                    error=identity_error,
                ),
            )
            self._publish_change()
            # Never annotate a replacement file with the stale job identity.
            logger.warning("Capture job %s rejected: %s", job.id, identity_error)
            return

        try:
            result = await self._processor(capture_path)
        except Exception as exc:  # noqa: BLE001 - custom/test processor boundary
            result = JobExecutionResult(
                status="failed",
                outcome="failed",
                error=str(exc) or exc.__class__.__name__,
                transient=_looks_transient(str(exc), exc),
            )

        if result.status in {"completed", "needs_review"}:
            await asyncio.to_thread(self.store.finish, job.id, result)
        else:
            await asyncio.to_thread(
                self.store.fail_or_retry,
                job.id,
                error=result.error or "Capture processing failed",
                transient=result.transient,
                base_backoff_seconds=self.policy.base_backoff_seconds,
            )
        self._publish_change()
        self._wake.set()

    def _capture_identity_error(self, job: CaptureJob, capture_path: Path) -> str:
        captures_dir = (self.vault_root / "threads" / "captures").resolve()
        try:
            resolved = capture_path.resolve()
            resolved.relative_to(captures_dir)
        except (OSError, ValueError):
            return "Capture job path is no longer inside the active Inbox"
        try:
            note = parse_note(resolved)
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            return "Capture file is no longer a valid note"
        if note.type != "capture" or note.status != "active":
            return "Capture file is no longer an active capture"
        if note.id != job.capture_id:
            return "Capture file was replaced after this job was queued"
        if note.source != job.source:
            return "Capture source changed after this job was queued"
        return ""

    def _has_filed_note(self, capture_id: str) -> bool:
        target = f"capture:{capture_id}"
        threads = self.vault_root / "threads"
        if not threads.exists():
            return False
        for path in threads.rglob("*.md"):
            if ".archive" in path.parts:
                continue
            try:
                if parse_note(path).source == target:
                    return True
            except (OSError, yaml.YAMLError, ValidationError, ValueError):
                continue
        return False

    @staticmethod
    def _publish_change() -> None:
        publish_capture_job_change()


class CaptureJobService:
    """Own the single active-vault worker and coordinate safe rebinds."""

    def __init__(self) -> None:
        self._worker: CaptureJobWorker | None = None
        self._lock = asyncio.Lock()
        self._enabled = False
        self._switching = False
        self._bound_root: Path | None = None

    @property
    def worker(self) -> CaptureJobWorker | None:
        return self._worker

    @property
    def enabled(self) -> bool:
        """Whether app lifecycle has enabled background processing."""
        return self._enabled

    def enable(self, vault_root: Path | None = None) -> None:
        """Mark the service live before a first vault exists."""
        self._enabled = True
        if vault_root is not None:
            self._bound_root = vault_root.resolve()

    @contextlib.asynccontextmanager
    async def operation_guard(self, vault_root: Path) -> AsyncIterator[None]:
        """Serialize a short job-store mutation against vault handoff."""
        root = vault_root.resolve()
        async with self._lock:
            if self._switching:
                raise CaptureJobsBusyError("The active vault is switching; try again")
            if self._enabled and self._bound_root is not None and self._bound_root != root:
                raise CaptureJobsBusyError("The active vault changed; retry this request")
            yield

    async def reserve_external(
        self,
        vault_root: Path,
        capture_path: Path,
        capture_id: str,
        source: str,
        policy: CaptureProcessingConfig,
    ) -> CaptureJob:
        """Serialize legacy reservations against active-vault handoff."""
        async with self._lock:
            if self._switching:
                raise CaptureJobsBusyError("The active vault is switching; try again")
            root = vault_root.resolve()
            if self._enabled and self._bound_root is not None and self._bound_root != root:
                raise CaptureJobsBusyError("The active vault changed; retry this request")
            store = CaptureJobStore(vault_root)
            return await asyncio.to_thread(
                store.reserve_external,
                capture_path,
                capture_id,
                source,
                policy,
            )

    async def activate(self, vault_root: Path, policy: CaptureProcessingConfig) -> CaptureJobWorker:
        """Administratively bind/rebind the worker after runtime handoff."""
        root = vault_root.resolve()
        async with self._lock:
            self._enabled = True
            if self._worker is not None and self._worker.vault_root == root:
                await self._worker.update_policy(policy)
                self._bound_root = root
                self._switching = False
                return self._worker
            if self._worker is not None:
                await self._worker.pause_claims()
                if await asyncio.to_thread(self._worker.store.has_running):
                    self._worker.resume_claims()
                    raise CaptureJobsBusyError(
                        "A capture is currently processing; wait before switching vaults"
                    )
                await self._worker.aclose(drain=True)
            worker = CaptureJobWorker(root, policy)
            await worker.start()
            self._worker = worker
            self._bound_root = root
            self._switching = False
            return worker

    async def ensure_active(
        self, vault_root: Path, policy: CaptureProcessingConfig
    ) -> CaptureJobWorker:
        """Self-heal a request's worker without overriding a vault handoff.

        Request paths call this only after their guarded store mutation. Unlike
        :meth:`activate`, it cannot clear ``switching`` or bind a different
        root; only the administrative runtime reload may complete that state
        transition.
        """
        root = vault_root.resolve()
        async with self._lock:
            if not self._enabled:
                raise CaptureJobsBusyError("Capture processing is not active")
            if self._switching:
                raise CaptureJobsBusyError("The active vault is switching; try again")
            if self._bound_root is not None and self._bound_root != root:
                raise CaptureJobsBusyError("The active vault changed; retry this request")
            if self._worker is not None:
                if self._worker.vault_root != root:
                    raise CaptureJobsBusyError("The capture worker is bound to a different vault")
                await self._worker.update_policy(policy)
                return self._worker
            worker = CaptureJobWorker(root, policy)
            await worker.start()
            self._worker = worker
            self._bound_root = root
            return worker

    async def prepare_vault_switch(self) -> None:
        """Stop the active worker, refusing to interrupt an in-flight pipeline."""
        async with self._lock:
            if not self._enabled:
                return
            if self._worker is None:
                if self._bound_root is not None:
                    store = CaptureJobStore(self._bound_root)
                    if await asyncio.to_thread(store.has_running):
                        raise CaptureJobsBusyError(
                            "A capture is currently processing; wait before switching vaults"
                        )
                self._switching = True
                return
            await self._worker.pause_claims()
            if await asyncio.to_thread(self._worker.store.has_running):
                self._worker.resume_claims()
                raise CaptureJobsBusyError(
                    "A capture is currently processing; wait before switching vaults"
                )
            await self._worker.aclose(drain=True)
            self._worker = None
            self._switching = True

    async def aclose(self) -> None:
        async with self._lock:
            if self._worker is not None:
                await self._worker.aclose()
                self._worker = None
            self._enabled = False
            self._switching = False
            self._bound_root = None

    def notify(self, vault_root: Path) -> None:
        worker = self._worker
        if worker is not None and worker.vault_root == vault_root.resolve():
            worker.notify()


_service = CaptureJobService()


def get_capture_job_service() -> CaptureJobService:
    return _service


def capture_job_store(vault_root: Path) -> CaptureJobStore:
    """Return a lightweight repository handle for an API request."""
    return CaptureJobStore(vault_root)


def publish_job_change() -> None:
    """Compatibility wrapper for the scoped capture-job refresh signal."""
    publish_capture_job_change()


async def enqueue_capture_for_policy(
    vault_root: Path,
    capture_path: Path,
    policy: CaptureProcessingConfig,
) -> CaptureJob | None:
    """Policy-gated enqueue used immediately after the capture gateway writes."""
    service = get_capture_job_service()
    async with service.operation_guard(vault_root):
        try:
            note = await asyncio.to_thread(parse_note, capture_path)
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            return None
        if (
            note.type != "capture"
            or note.status != "active"
            or _terminal_capture_marker(note)
            or not policy.permits(note.source)
        ):
            return None
        store = capture_job_store(vault_root)
        result = await asyncio.to_thread(store.enqueue, capture_path, note.id, note.source, policy)
    if result.created:
        publish_job_change()
        service.notify(vault_root)
    return result.job


async def reset_capture_job_service_for_tests() -> None:
    """Close the singleton worker; intentionally public for hermetic tests."""
    await _service.aclose()


def force_reset_capture_job_service_for_tests() -> None:
    """Drop test-owned singleton state after TestClient closes its event loop.

    Starlette's non-context-managed ``TestClient`` may create and then close a
    portal loop per request. Tasks created by an onboarding/vault-switch route
    are already cancelled when that loop closes and cannot safely be awaited
    from the next test's loop; this reset only clears those dead handles.
    """
    worker = _service.worker
    if worker is not None:
        for task in worker._tasks.values():
            if not task.done():
                task.cancel()
        if worker._discovery_task is not None and not worker._discovery_task.done():
            worker._discovery_task.cancel()
        worker._release_process_lease()
    _service._worker = None
    _service._enabled = False
    _service._switching = False
    _service._bound_root = None
    _service._lock = asyncio.Lock()

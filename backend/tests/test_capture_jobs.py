"""Durability, recovery, discovery, and worker tests for capture jobs."""

from __future__ import annotations

import asyncio
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from core.capture_jobs import (
    CaptureJob,
    CaptureJobConflictError,
    CaptureJobsBusyError,
    CaptureJobService,
    CaptureJobStore,
    CaptureJobWorker,
    JobExecutionResult,
)
from core.config import CaptureProcessingConfig
from core.events import CAPTURE_JOB_CHANGED, get_event_hub
from core.notes import note_to_file_content, parse_note


def _vault(tmp_path: Path, name: str = "vault") -> Path:
    root = tmp_path / name
    (root / ".loom").mkdir(parents=True)
    (root / "threads" / "captures").mkdir(parents=True)
    (root / "vault.yaml").write_text(f"name: {name}\n")
    return root


def _write_capture(
    root: Path,
    capture_id: str,
    *,
    source: str = "manual",
    filename: str | None = None,
    extra: dict[str, object] | None = None,
) -> Path:
    path = root / "threads" / "captures" / (filename or f"{capture_id}.md")
    meta: dict[str, object] = {
        "id": capture_id,
        "title": f"Capture {capture_id}",
        "type": "capture",
        "tags": [],
        "created": "2026-07-13T12:00:00+00:00",
        "modified": "2026-07-13T12:00:00+00:00",
        "author": "user",
        "source": source,
        "status": "active",
        "history": [],
    }
    meta.update(extra or {})
    path.write_text(note_to_file_content(meta, "## Content\n\nQueue me."))
    return path


def _policy(**updates: object) -> CaptureProcessingConfig:
    return CaptureProcessingConfig.model_validate({"base_backoff_seconds": 0.1, **updates})


def _completed(path: Path) -> JobExecutionResult:
    return JobExecutionResult(
        status="completed",
        outcome="filed",
        note_id="thr_note",
        note_title="Filed Note",
        note_type="topic",
        target_path=str(path.parent.parent / "topics" / "filed.md"),
    )


def _make_stale(store: CaptureJobStore, job_id: str, *, seconds: float = 7200.0) -> None:
    """Backdate a running row's liveness timestamps past any stale cutoff."""
    aged = (datetime.now(UTC) - timedelta(seconds=seconds)).isoformat()
    with sqlite3.connect(store.db_path) as connection:
        connection.execute(
            "UPDATE capture_jobs SET started_at = ?, updated_at = ? WHERE id = ?",
            (aged, aged, job_id),
        )


def test_store_is_persistent_and_enqueue_is_idempotent(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1", source="bridge:gmail")
    policy = _policy(max_retries=3)

    first = CaptureJobStore(root).enqueue(capture, "thr_cap1", "bridge:gmail", policy)
    second_store = CaptureJobStore(root)
    second = second_store.enqueue(capture, "thr_cap1", "bridge:gmail", policy)

    assert first.created is True
    assert second.created is False
    assert second.job.id == first.job.id
    assert second.job.max_attempts == 4
    assert second_store.get(first.job.id) == first.job
    assert (root / ".loom" / "capture-jobs.sqlite3").exists()


def test_claim_and_terminal_completion_are_durable(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    queued = store.enqueue(capture, "thr_cap1", "manual", _policy()).job

    running = store.claim_next()
    assert running is not None
    assert running.id == queued.id
    assert running.status == "running"
    assert running.attempts == 1

    finished = store.finish(running.id, _completed(capture))
    assert finished.status == "completed"
    assert finished.outcome == "filed"
    assert finished.note_id == "thr_note"
    assert CaptureJobStore(root).get(running.id) == finished


def test_history_pruning_keeps_actionable_failures(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    store = CaptureJobStore(root)

    completed_capture = _write_capture(root, "thr_completed")
    completed = store.enqueue(
        completed_capture,
        "thr_completed",
        "manual",
        _policy(),
    ).job
    assert store.claim_next() is not None
    store.finish(completed.id, _completed(completed_capture))

    cancelled_capture = _write_capture(root, "thr_cancelled")
    cancelled = store.enqueue(
        cancelled_capture,
        "thr_cancelled",
        "manual",
        _policy(),
    ).job
    store.cancel(cancelled.id)

    failed_capture = _write_capture(root, "thr_failed")
    failed = store.enqueue(
        failed_capture,
        "thr_failed",
        "manual",
        _policy(),
    ).job
    assert store.claim_next() is not None
    store.fail_or_retry(
        failed.id,
        error="Needs attention",
        transient=False,
        base_backoff_seconds=0.1,
    )

    assert store.prune_history(before=datetime.now(UTC) - timedelta(days=1)) == 0
    assert store.prune_history(before=datetime.now(UTC) + timedelta(days=1)) == 2
    assert store.get(completed.id) is None
    assert store.get(cancelled.id) is None
    assert store.get(failed.id) is not None
    assert store.get(failed.id).status == "failed"  # type: ignore[union-attr]


def test_transient_failures_back_off_then_stop_at_bound(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    queued = store.enqueue(capture, "thr_cap1", "manual", _policy(max_retries=1)).job

    first = store.claim_next()
    assert first is not None
    retrying = store.fail_or_retry(
        queued.id,
        error="connection timed out",
        transient=True,
        base_backoff_seconds=0.1,
    )
    assert retrying.status == "retrying"
    assert retrying.outcome is None
    assert store.claim_next() is None

    time.sleep(0.12)
    second = store.claim_next()
    assert second is not None
    terminal = store.fail_or_retry(
        queued.id,
        error="connection timed out again",
        transient=True,
        base_backoff_seconds=0.1,
    )
    assert terminal.status == "failed"
    assert terminal.outcome == "failed"
    assert terminal.attempts == 2


def test_non_transient_failure_does_not_auto_retry(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    job = store.enqueue(capture, "thr_cap1", "manual", _policy(max_retries=5)).job
    assert store.claim_next() is not None

    failed = store.fail_or_retry(
        job.id,
        error="Weaver agent not initialized",
        transient=False,
        base_backoff_seconds=0.1,
    )

    assert failed.status == "failed"
    assert failed.attempts == 1


def test_sync_reservation_preserves_background_retry_budget(tmp_path: Path) -> None:
    """A legacy /process reservation must not consume the backoff retry budget.

    Reserving a capture for the synchronous pipeline marks the row ``running``
    for observability, but ``attempts`` counts worker claims only: after a
    crash mid-reservation, the recovered job must still get its full
    max_retries backoff sequence instead of going terminal on the first
    transient failure.
    """
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    policy = _policy(max_retries=1)  # max_attempts = 2

    reserved = store.reserve_external(capture, "thr_cap1", "manual", policy)
    assert reserved.status == "running"
    assert reserved.attempts == 0
    assert reserved.max_attempts == 2

    # Simulate a crash before the sync result was reconciled: startup recovery
    # requeues the reservation, then the worker's first transient failure must
    # schedule a backoff retry rather than an immediate terminal failure.
    recovered = store.recover_interrupted()
    assert recovered[0].status == "retrying"

    first = store.claim_next()
    assert first is not None
    assert first.attempts == 1
    retrying = store.fail_or_retry(
        first.id,
        error="connection timed out",
        transient=True,
        base_backoff_seconds=0.1,
    )
    assert retrying.status == "retrying"
    assert retrying.outcome is None

    # The budget is still bounded: the next transient failure goes terminal.
    time.sleep(0.12)
    second = store.claim_next()
    assert second is not None
    terminal = store.fail_or_retry(
        second.id,
        error="connection timed out again",
        transient=True,
        base_backoff_seconds=0.1,
    )
    assert terminal.status == "failed"
    assert terminal.attempts == 2


def test_repeated_sync_reservations_do_not_inflate_attempts(tmp_path: Path) -> None:
    """Repeated manual /process runs must not erode a later background retry."""
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    policy = _policy(max_retries=1)  # max_attempts = 2

    for _ in range(3):
        reserved = store.reserve_external(capture, "thr_cap1", "manual", policy)
        assert reserved.attempts == 0
        finished = store.finish(
            reserved.id,
            JobExecutionResult(status="failed", outcome="failed", error="boom"),
        )
        assert finished.status == "failed"
        assert finished.attempts == 0

    # A crash during the next reservation still grants the full retry budget.
    store.reserve_external(capture, "thr_cap1", "manual", policy)
    assert store.recover_interrupted()[0].status == "retrying"
    claimed = store.claim_next()
    assert claimed is not None
    assert claimed.attempts == 1
    retrying = store.fail_or_retry(
        claimed.id,
        error="connection timed out",
        transient=True,
        base_backoff_seconds=0.1,
    )
    assert retrying.status == "retrying"


def test_claim_and_synchronous_cancel_never_overwrite_running_state(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    store = CaptureJobStore(root)

    for index in range(12):
        capture_id = f"thr_race{index}"
        capture = _write_capture(root, capture_id)
        queued = store.enqueue(capture, capture_id, "manual", _policy()).job
        barrier = threading.Barrier(2)

        def claim(sync: threading.Barrier = barrier) -> object:
            sync.wait()
            return store.claim_next()

        def cancel(sync: threading.Barrier = barrier, current_id: str = capture_id) -> object:
            sync.wait()
            try:
                return store.cancel_by_capture(current_id, "manual path won")
            except CaptureJobConflictError as exc:
                return exc

        with ThreadPoolExecutor(max_workers=2) as pool:
            claimed_future = pool.submit(claim)
            cancelled_future = pool.submit(cancel)
            claimed = claimed_future.result()
            cancelled = cancelled_future.result()

        final = store.get(queued.id)
        assert final is not None
        if final.status == "running":
            assert getattr(claimed, "id", None) == queued.id
            assert isinstance(cancelled, CaptureJobConflictError)
            store.finish(queued.id, _completed(capture))
        else:
            assert final.status == "cancelled"
            assert claimed is None


@pytest.mark.asyncio
async def test_interrupted_final_attempt_gets_one_idempotent_recovery(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    job = store.enqueue(capture, "thr_cap1", "manual", _policy(max_retries=0)).job
    assert store.claim_next() is not None

    recovered = store.recover_interrupted()
    assert recovered[0].status == "retrying"
    assert recovered[0].max_attempts == 2
    running = store.claim_next()
    assert running is not None

    # Simulate a crash after the pipeline wrote its note and archived source,
    # but before the job row was finalized.
    topic = root / "threads" / "topics" / "filed.md"
    topic.parent.mkdir(parents=True)
    topic.write_text(
        note_to_file_content(
            {
                "id": "thr_note",
                "title": "Filed",
                "type": "topic",
                "source": "capture:thr_cap1",
                "history": [],
            },
            "Filed body",
        )
    )
    capture.unlink()
    worker = CaptureJobWorker(root, _policy())
    await worker._execute(running, capture)

    final = store.get(job.id)
    assert final is not None
    assert final.status == "completed"
    assert final.outcome == "filed"


def test_repeated_restart_recovery_is_bounded(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    job = store.enqueue(capture, "thr_cap1", "manual", _policy(max_retries=0)).job
    assert store.claim_next() is not None

    first_recovery = store.recover_interrupted()[0]
    assert first_recovery.status == "retrying"
    assert store.claim_next() is not None

    second_recovery = store.recover_interrupted()[0]
    assert second_recovery.status == "failed"
    assert second_recovery.outcome == "failed"
    assert second_recovery.attempts == 2
    assert store.claim_next() is None
    assert store.get(job.id) == second_recovery


@pytest.mark.asyncio
async def test_discovery_respects_trusted_policy_and_terminal_markers(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    allowed = _write_capture(root, "thr_allowed", source="Agent:Researcher", filename="allowed.md")
    _write_capture(root, "thr_blocked", source="manual", filename="blocked.md")
    _write_capture(
        root,
        "thr_review",
        source="agent:researcher",
        filename="review.md",
        extra={"enforcement_outcome": "needs_review", "review_required": True},
    )
    worker = CaptureJobWorker(
        root,
        _policy(mode="trusted", trusted_sources=[" agent:researcher "]),
    )

    assert await worker.reconcile() == 1
    jobs = worker.store.list_jobs()
    assert [job.capture_id for job in jobs] == ["thr_allowed"]
    assert jobs[0].capture_path == str(allowed.resolve())


@pytest.mark.asyncio
async def test_worker_rejects_replaced_capture_identity(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_original", filename="same.md")
    called = False

    async def processor(path: Path) -> JobExecutionResult:
        nonlocal called
        called = True
        return _completed(path)

    worker = CaptureJobWorker(root, _policy(), processor=processor)
    job = worker.store.enqueue(capture, "thr_original", "manual", _policy()).job
    running = worker.store.claim_next()
    assert running is not None
    _write_capture(root, "thr_replacement", filename="same.md")

    await worker._execute(running, capture)

    final = worker.store.get(job.id)
    assert final is not None
    assert final.status == "failed"
    assert "replaced" in final.error.lower()
    assert called is False


@pytest.mark.asyncio
async def test_worker_rejects_capture_source_changed_after_enqueue(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_original", source="agent:researcher")
    worker = CaptureJobWorker(root, _policy())
    job = worker.store.enqueue(capture, "thr_original", "agent:researcher", _policy()).job
    running = worker.store.claim_next()
    assert running is not None
    _write_capture(root, "thr_original", source="manual")

    await worker._execute(running, capture)

    final = worker.store.get(job.id)
    assert final is not None
    assert final.status == "failed"
    assert "source changed" in final.error.lower()


@pytest.mark.asyncio
async def test_job_state_only_transition_emits_only_job_domain(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")

    async def processor(path: Path) -> JobExecutionResult:
        return _completed(path)

    worker = CaptureJobWorker(root, _policy(), processor=processor)
    queued = worker.store.enqueue(capture, "thr_cap1", "manual", _policy()).job
    running = worker.store.claim_next()
    assert running is not None
    hub = get_event_hub()
    events = hub.subscribe()
    try:
        await worker._execute(running, capture)

        assert events.get_nowait() == CAPTURE_JOB_CHANGED
        assert events.empty()
    finally:
        hub.unsubscribe(events)

    assert worker.store.get(queued.id).status == "completed"  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_worker_processes_jobs_without_rewriting_capture_frontmatter(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")

    async def processor(path: Path) -> JobExecutionResult:
        return _completed(path)

    worker = CaptureJobWorker(root, _policy(), processor=processor)
    job = worker.store.enqueue(capture, "thr_cap1", "manual", _policy()).job
    await worker.start()
    worker.notify()
    try:
        for _ in range(100):
            current = worker.store.get(job.id)
            if current is not None and current.status == "completed":
                break
            await asyncio.sleep(0.01)
        else:
            pytest.fail("worker did not finish queued capture")
    finally:
        await worker.aclose()

    untouched = parse_note(capture)
    assert "processing_status" not in untouched.extra
    assert "job_id" not in untouched.extra


@pytest.mark.asyncio
async def test_concurrency_can_shrink_then_grow_again(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    worker = CaptureJobWorker(root, _policy(concurrency=3))
    await worker.start()
    try:
        await worker.update_policy(_policy(concurrency=1))
        for _ in range(100):
            if all(index == 0 or task.done() for index, task in worker._tasks.items()):
                break
            await asyncio.sleep(0.01)
        await worker.update_policy(_policy(concurrency=3))
        active = {index for index, task in worker._tasks.items() if not task.done()}
        assert active == {0, 1, 2}
    finally:
        await worker.aclose()


@pytest.mark.asyncio
async def test_service_rebinds_without_polling_old_vault(tmp_path: Path) -> None:
    first = _vault(tmp_path, "first")
    second = _vault(tmp_path, "second")
    service = CaptureJobService()
    first_worker = await service.activate(first, _policy())
    await service.prepare_vault_switch()
    assert service.worker is None
    assert first_worker.running is False

    second_worker = await service.activate(second, _policy())
    try:
        assert service.worker is second_worker
        assert second_worker.vault_root == second.resolve()
        assert first_worker.vault_root == first.resolve()
    finally:
        await service.aclose()


@pytest.mark.asyncio
async def test_second_worker_cannot_recover_live_claims_for_same_vault(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    first = CaptureJobWorker(root, _policy())
    second = CaptureJobWorker(root, _policy())
    await first.start()
    try:
        with pytest.raises(CaptureJobsBusyError):
            await second.start()
    finally:
        await first.aclose()

    await second.start()
    await second.aclose()


@pytest.mark.asyncio
async def test_request_self_heal_cannot_override_vault_handoff(
    tmp_path: Path,
) -> None:
    first = _vault(tmp_path, "first")
    second = _vault(tmp_path, "second")
    service = CaptureJobService()
    await service.activate(first, _policy())
    await service.prepare_vault_switch()

    with pytest.raises(CaptureJobsBusyError):
        await service.ensure_active(first, _policy())

    assert service.worker is None
    rebound = await service.activate(second, _policy())
    try:
        assert rebound.vault_root == second.resolve()
    finally:
        await service.aclose()


@pytest.mark.asyncio
async def test_switch_checks_external_reservation_without_worker(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    policy = _policy()
    service = CaptureJobService()
    service.enable(root)
    store = CaptureJobStore(root)
    running = store.reserve_external(capture, "thr_cap1", "manual", policy)

    with pytest.raises(CaptureJobsBusyError):
        await service.prepare_vault_switch()

    store.finish(running.id, _completed(capture))
    await service.prepare_vault_switch()
    await service.aclose()


@pytest.mark.asyncio
async def test_service_refuses_vault_switch_while_job_is_running(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    service = CaptureJobService()
    worker = await service.activate(root, _policy())
    await worker.pause_claims()
    job = worker.store.enqueue(capture, "thr_cap1", "manual", _policy()).job
    running = worker.store.claim_next()
    assert running is not None
    worker.resume_claims()

    with pytest.raises(CaptureJobsBusyError):
        await service.prepare_vault_switch()

    assert service.worker is worker
    worker.store.finish(job.id, _completed(capture))
    await service.aclose()


def test_reclaim_stale_running_requeues_with_remaining_budget(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    queued = store.enqueue(capture, "thr_cap1", "manual", _policy(max_retries=2)).job
    claimed = store.claim_next()
    assert claimed is not None
    assert claimed.attempts == 1
    _make_stale(store, queued.id)

    reclaimed = store.reclaim_stale_running(stale_after_seconds=1800.0)

    assert [job.id for job in reclaimed] == [queued.id]
    stale = reclaimed[0]
    assert stale.status == "retrying"
    assert stale.outcome is None
    # The stranded claim already consumed this attempt; reclaiming adds none.
    assert stale.attempts == 1
    assert stale.max_attempts == 3
    assert stale.error == "Stale running job reclaimed (no liveness for 1800s)"
    assert stale.finished_at == ""

    # The row is fresh again, and the requeue keeps its remaining budget.
    assert store.reclaim_stale_running(stale_after_seconds=1800.0) == []
    reclaimed_claim = store.claim_next()
    assert reclaimed_claim is not None
    assert reclaimed_claim.attempts == 2
    finished = store.finish(queued.id, _completed(capture))
    assert finished.status == "completed"


def test_reclaim_stale_running_grants_one_extension_then_fails(tmp_path: Path) -> None:
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    store = CaptureJobStore(root)
    job = store.enqueue(capture, "thr_cap1", "manual", _policy(max_retries=0)).job
    assert store.claim_next() is not None
    _make_stale(store, job.id)

    first = store.reclaim_stale_running(stale_after_seconds=1800.0)[0]
    assert first.status == "retrying"
    assert first.attempts == 1
    assert first.max_attempts == 2  # one bounded reconciliation claim granted

    reclaimed_claim = store.claim_next()
    assert reclaimed_claim is not None
    assert reclaimed_claim.attempts == 2
    _make_stale(store, job.id)

    second = store.reclaim_stale_running(stale_after_seconds=1800.0)[0]
    assert second.status == "failed"
    assert second.outcome == "failed"
    assert second.finished_at != ""
    assert "no liveness" in second.error
    assert store.claim_next() is None
    assert store.get(job.id) == second


def test_reclaim_stale_running_leaves_fresh_and_non_running_rows_untouched(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    store = CaptureJobStore(root)

    running_capture = _write_capture(root, "thr_running")
    running = store.enqueue(running_capture, "thr_running", "manual", _policy()).job
    assert store.claim_next() is not None

    failed_capture = _write_capture(root, "thr_failed")
    failed = store.enqueue(failed_capture, "thr_failed", "manual", _policy()).job
    assert store.claim_next() is not None
    store.fail_or_retry(
        failed.id,
        error="boom",
        transient=False,
        base_backoff_seconds=0.1,
    )

    queued_capture = _write_capture(root, "thr_queued")
    queued = store.enqueue(queued_capture, "thr_queued", "manual", _policy()).job

    # Real "now" keeps every liveness timestamp younger than the cutoff.
    assert store.reclaim_stale_running(stale_after_seconds=1800.0) == []
    assert store.get(running.id).status == "running"  # type: ignore[union-attr]
    assert store.get(queued.id).status == "queued"  # type: ignore[union-attr]
    assert store.get(failed.id).status == "failed"  # type: ignore[union-attr]


def test_reclaim_stale_running_never_clobbers_a_concurrent_finish(
    tmp_path: Path,
) -> None:
    root = _vault(tmp_path)
    store = CaptureJobStore(root)

    for index in range(12):
        capture_id = f"thr_race{index}"
        capture = _write_capture(root, capture_id)
        queued = store.enqueue(capture, capture_id, "manual", _policy()).job
        claimed = store.claim_next()
        assert claimed is not None
        _make_stale(store, claimed.id)
        barrier = threading.Barrier(2)

        def finish(
            sync: threading.Barrier = barrier,
            job_id: str = claimed.id,
            path: Path = capture,
        ) -> CaptureJob | CaptureJobConflictError:
            sync.wait()
            try:
                return store.finish(job_id, _completed(path))
            except CaptureJobConflictError as exc:
                return exc

        def reclaim(sync: threading.Barrier = barrier) -> list[CaptureJob]:
            sync.wait()
            return store.reclaim_stale_running(stale_after_seconds=1800.0)

        with ThreadPoolExecutor(max_workers=2) as pool:
            finished = pool.submit(finish)
            reclaimed = pool.submit(reclaim)
            finish_result = finished.result()
            reclaim_result = reclaimed.result()

        final = store.get(queued.id)
        assert final is not None
        if final.status == "completed":
            # The live executor won; the stale sweep observed its outcome.
            assert reclaim_result == []
        else:
            # The sweep committed first; the late finish must not clobber it.
            assert final.status == "retrying"
            assert [job.id for job in reclaim_result] == [queued.id]
            assert isinstance(finish_result, CaptureJobConflictError)
            assert store.claim_next() is not None
            store.finish(queued.id, _completed(capture))


@pytest.mark.asyncio
async def test_worker_start_invokes_stale_reclaim_with_policy_cutoff(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _vault(tmp_path)
    calls: list[float] = []
    original = CaptureJobStore.reclaim_stale_running

    def spy(
        self: CaptureJobStore,
        *,
        stale_after_seconds: float,
        now: datetime | None = None,
    ) -> list[CaptureJob]:
        calls.append(stale_after_seconds)
        return original(self, stale_after_seconds=stale_after_seconds, now=now)

    monkeypatch.setattr(CaptureJobStore, "reclaim_stale_running", spy)
    worker = CaptureJobWorker(root, _policy(mode="manual", stale_running_seconds=120.0))
    await worker.start()
    try:
        assert calls == [120.0]
    finally:
        await worker.aclose()


@pytest.mark.asyncio
async def test_worker_start_recovers_previous_process_running_row_in_manual_mode(
    tmp_path: Path,
) -> None:
    """A running row orphaned by a previous process advances after boot.

    Manual mode disables discovery only: startup recovery plus the live
    worker still drain durable work, so the row must not spin forever.
    """
    root = _vault(tmp_path)
    capture = _write_capture(root, "thr_cap1")
    policy = _policy(mode="manual")
    stranded = CaptureJobStore(root).reserve_external(capture, "thr_cap1", "manual", policy)
    assert stranded.status == "running"

    async def processor(path: Path) -> JobExecutionResult:
        return _completed(path)

    worker = CaptureJobWorker(root, policy, processor=processor)
    await worker.start()
    try:
        for _ in range(100):
            current = worker.store.get(stranded.id)
            if current is not None and current.status == "completed":
                break
            await asyncio.sleep(0.01)
        else:
            pytest.fail("previous-process running row was not recovered on startup")
    finally:
        await worker.aclose()

    final = worker.store.get(stranded.id)
    assert final is not None
    assert final.status == "completed"
    assert final.outcome == "filed"

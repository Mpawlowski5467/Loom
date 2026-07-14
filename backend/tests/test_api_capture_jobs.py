"""API contract tests for durable Inbox processing jobs and policy."""

import asyncio
import threading
from pathlib import Path
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from core.capture_jobs import CaptureJobStore, JobExecutionResult, capture_job_store
from core.config import GlobalConfig
from core.notes import note_to_file_content, parse_note
from core.vault_io import VaultIOError
from tests.conftest import _seed_notes


@pytest.fixture()
def empty_job_vault(vault_manager, note_index) -> Path:
    return _seed_notes(vault_manager, note_index, [])


def _create_capture(
    client: TestClient,
    *,
    title: str = "Queue item",
    source: str = "manual",
) -> dict:
    response = client.post(
        "/api/captures",
        json={"title": title, "body": "Process this", "source": source},
    )
    assert response.status_code == 201
    return response.json()


def test_processing_policy_defaults_to_manual(client: TestClient, empty_job_vault: Path) -> None:
    response = client.get("/api/captures/processing-policy")

    assert response.status_code == 200
    assert response.json() == {
        "mode": "manual",
        "trusted_sources": [],
        "concurrency": 1,
        "max_retries": 2,
        "base_backoff_seconds": 2.0,
    }


def test_processing_policy_patch_normalizes_and_persists(
    client: TestClient, empty_job_vault: Path, vault_manager
) -> None:
    response = client.patch(
        "/api/captures/processing-policy",
        json={
            "mode": "trusted",
            "trusted_sources": [" Agent:Researcher ", "agent:researcher", "bridge:gmail"],
            "concurrency": 2,
            "max_retries": 4,
            "base_backoff_seconds": 3,
        },
    )

    assert response.status_code == 200
    assert response.json()["trusted_sources"] == ["agent:researcher", "bridge:gmail"]
    persisted = GlobalConfig.load(vault_manager.config_path()).capture_processing
    assert persisted.mode == "trusted"
    assert persisted.concurrency == 2
    assert persisted.max_retries == 4


def test_explicit_enqueue_is_idempotent_and_list_is_raw_array(
    client: TestClient, empty_job_vault: Path
) -> None:
    capture = _create_capture(client)["capture"]

    first = client.post("/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]})
    second = client.post("/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["status"] == "queued"
    assert first.json()["capture_id"] == capture["id"]
    jobs = client.get("/api/captures/jobs").json()
    assert isinstance(jobs, list)
    assert [job["id"] for job in jobs] == [first.json()["id"]]


def test_batch_enqueue_deduplicates_paths_in_input_order(
    client: TestClient, empty_job_vault: Path
) -> None:
    first = _create_capture(client, title="First")["capture"]
    second = _create_capture(client, title="Second")["capture"]

    response = client.post(
        "/api/captures/jobs/enqueue-batch",
        json={
            "capture_paths": [
                first["file_path"],
                first["file_path"],
                second["file_path"],
            ]
        },
    )

    assert response.status_code == 200
    assert [job["capture_id"] for job in response.json()] == [first["id"], second["id"]]


def test_cancel_and_manual_retry_update_durable_state(
    client: TestClient, empty_job_vault: Path
) -> None:
    capture = _create_capture(client)["capture"]
    job = client.post(
        "/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]}
    ).json()

    cancelled = client.post(f"/api/captures/jobs/{job['id']}/cancel")
    retried = client.post(f"/api/captures/jobs/{job['id']}/retry")

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert retried.status_code == 200
    assert retried.json()["status"] == "queued"
    assert retried.json()["attempts"] == 0


def test_history_retention_removes_only_completed_and_cancelled_jobs(
    client: TestClient,
    empty_job_vault: Path,
    vault_manager,
) -> None:
    completed_capture = _create_capture(client, title="Completed")["capture"]
    cancelled_capture = _create_capture(client, title="Cancelled")["capture"]
    failed_capture = _create_capture(client, title="Failed")["capture"]
    store = capture_job_store(empty_job_vault)
    policy = GlobalConfig.load(vault_manager.config_path()).capture_processing

    completed = store.enqueue(
        Path(completed_capture["file_path"]),
        completed_capture["id"],
        completed_capture["source"],
        policy,
    ).job
    assert store.claim_next() is not None
    store.finish(
        completed.id,
        JobExecutionResult(
            status="completed",
            outcome="filed",
            note_id="thr_note",
            note_title="Filed note",
        ),
    )

    cancelled = store.enqueue(
        Path(cancelled_capture["file_path"]),
        cancelled_capture["id"],
        cancelled_capture["source"],
        policy,
    ).job
    store.cancel(cancelled.id)

    failed = store.enqueue(
        Path(failed_capture["file_path"]),
        failed_capture["id"],
        failed_capture["source"],
        policy,
    ).job
    assert store.claim_next() is not None
    store.fail_or_retry(
        failed.id,
        error="Keep this evidence",
        transient=False,
        base_backoff_seconds=0.1,
    )

    response = client.delete("/api/captures/jobs/history")

    assert response.status_code == 200
    assert response.json() == {"deleted": 2}
    remaining = client.get("/api/captures/jobs").json()
    assert [job["id"] for job in remaining] == [failed.id]
    assert remaining[0]["error"] == "Keep this evidence"


def test_cancel_rejects_running_job(client: TestClient, empty_job_vault: Path) -> None:
    capture = _create_capture(client)["capture"]
    job = client.post(
        "/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]}
    ).json()
    claimed = capture_job_store(empty_job_vault).claim_next()
    assert claimed is not None

    response = client.post(f"/api/captures/jobs/{job['id']}/cancel")

    assert response.status_code == 409
    assert capture_job_store(empty_job_vault).get(job["id"]).status == "running"  # type: ignore[union-attr]


def test_gateway_auto_enqueues_all_mode(client: TestClient, empty_job_vault: Path) -> None:
    policy = client.patch("/api/captures/processing-policy", json={"mode": "all"})
    assert policy.status_code == 200

    created = _create_capture(client, source="agent:custom")

    assert created["job"] is not None
    assert created["job"]["status"] == "queued"
    assert created["job"]["capture_id"] == created["capture"]["id"]


def test_trusted_mode_only_auto_enqueues_allowlisted_source(
    client: TestClient, empty_job_vault: Path
) -> None:
    response = client.patch(
        "/api/captures/processing-policy",
        json={"mode": "trusted", "trusted_sources": ["agent:researcher"]},
    )
    assert response.status_code == 200

    blocked = _create_capture(client, title="Manual", source="manual")
    allowed = _create_capture(client, title="Research", source="Agent:Researcher")

    assert blocked["job"] is None
    assert allowed["job"] is not None
    jobs = client.get("/api/captures/jobs").json()
    assert [job["capture_id"] for job in jobs] == [allowed["capture"]["id"]]


def test_retry_rejects_a_replaced_capture_file(client: TestClient, empty_job_vault: Path) -> None:
    capture = _create_capture(client)["capture"]
    job = client.post(
        "/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]}
    ).json()
    assert client.post(f"/api/captures/jobs/{job['id']}/cancel").status_code == 200

    path = Path(capture["file_path"])
    note = parse_note(path)
    meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["id"] = "thr_replacement"
    path.write_text(note_to_file_content(meta, note.body))

    response = client.post(f"/api/captures/jobs/{job['id']}/retry")

    assert response.status_code == 409
    assert "replaced" in response.json()["detail"].lower()


def test_successful_skip_cancels_existing_job(
    client: TestClient, empty_job_vault: Path
) -> None:
    capture = _create_capture(client)["capture"]
    job = client.post(
        "/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]}
    ).json()

    skipped = client.post("/api/captures/skip", json={"capture_path": capture["file_path"]})

    assert skipped.status_code == 200
    stored = capture_job_store(empty_job_vault).get(job["id"])
    assert stored is not None
    assert stored.status == "cancelled"
    assert not Path(capture["file_path"]).exists()


def test_failed_skip_move_restores_exact_pending_job(
    client: TestClient, empty_job_vault: Path
) -> None:
    capture = _create_capture(client)["capture"]
    job = client.post(
        "/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]}
    ).json()
    before = capture_job_store(empty_job_vault).get(job["id"])
    assert before is not None

    with patch("api.routers.captures.shutil.move", side_effect=OSError("disk failure")):
        response = client.post(
            "/api/captures/skip", json={"capture_path": capture["file_path"]}
        )

    assert response.status_code == 500
    assert capture_job_store(empty_job_vault).get(job["id"]) == before
    assert Path(capture["file_path"]).exists()
    assert parse_note(Path(capture["file_path"])).status == "active"


def test_failed_skip_write_restores_exact_pending_job(
    client: TestClient, empty_job_vault: Path
) -> None:
    capture = _create_capture(client)["capture"]
    job = client.post(
        "/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]}
    ).json()
    before = capture_job_store(empty_job_vault).get(job["id"])
    assert before is not None

    with patch(
        "api.routers.captures.vault_write_note",
        side_effect=VaultIOError("write failed"),
    ):
        response = client.post(
            "/api/captures/skip", json={"capture_path": capture["file_path"]}
        )

    assert response.status_code == 400
    assert capture_job_store(empty_job_vault).get(job["id"]) == before
    assert Path(capture["file_path"]).exists()


@pytest.mark.asyncio
async def test_cancelled_skip_request_restores_job_committed_by_thread(
    client: TestClient,
    empty_job_vault: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.routers.captures import _cancel_pending_job_unlocked

    capture = _create_capture(client)["capture"]
    job = client.post(
        "/api/captures/jobs/enqueue", json={"capture_path": capture["file_path"]}
    ).json()
    before = capture_job_store(empty_job_vault).get(job["id"])
    assert before is not None
    committed = threading.Event()
    release = threading.Event()
    original = CaptureJobStore.cancel_by_capture_with_snapshot

    def cancel_then_block(self, capture_id: str, reason: str):
        result = original(self, capture_id, reason)
        committed.set()
        assert release.wait(timeout=2)
        return result

    monkeypatch.setattr(
        CaptureJobStore,
        "cancel_by_capture_with_snapshot",
        cancel_then_block,
    )
    task = asyncio.create_task(
        _cancel_pending_job_unlocked(
            empty_job_vault,
            Path(capture["file_path"]),
            "Cancelled because the capture was skipped",
        )
    )
    assert await asyncio.to_thread(committed.wait, 2)

    task.cancel()
    await asyncio.sleep(0)
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert capture_job_store(empty_job_vault).get(job["id"]) == before
    assert Path(capture["file_path"]).exists()


def test_legacy_process_all_rejects_any_running_job_before_mutation(
    client: TestClient, empty_job_vault: Path
) -> None:
    first = _create_capture(client, title="First")["capture"]
    second = _create_capture(client, title="Second")["capture"]
    jobs = client.post(
        "/api/captures/jobs/enqueue-batch",
        json={"capture_paths": [first["file_path"], second["file_path"]]},
    ).json()
    claimed = capture_job_store(empty_job_vault).claim_next()
    assert claimed is not None

    with patch("agents.loom.weaver.get_weaver", return_value=object()):
        response = client.post("/api/captures/process-all")

    assert response.status_code == 409
    untouched = capture_job_store(empty_job_vault).get(jobs[1]["id"])
    assert untouched is not None
    assert untouched.status == "queued"

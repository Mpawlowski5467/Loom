#!/usr/bin/env python3
"""Run a provider-free release drill through Loom's real FastAPI routes.

The drill uses a temporary Loom home and exercises durable capture recovery,
vault export, failed-overwrite rollback, and clean import. It never reads or
writes the user's configured vaults and makes no provider/network calls.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from starlette.testclient import TestClient

from api.main import app
from core.capture_jobs import (
    capture_job_store,
    force_reset_capture_job_service_for_tests,
)
from core.config import LoomSettings
from core.note_index import NoteIndex, get_note_index
from core.rate_limit import limiter
from core.vault import VaultManager, get_vault_manager


def _require(response: Any, status: int, step: str) -> Any:
    if response.status_code != status:
        raise RuntimeError(f"{step} returned {response.status_code}: {response.text[:500]}")
    return response


def run_drill() -> dict[str, Any]:
    """Execute the drill and return a machine-readable evidence report."""
    with tempfile.TemporaryDirectory(prefix="loom-product-drill-") as raw:
        settings = LoomSettings(loom_home=Path(raw) / "loom-home")
        manager = VaultManager(settings)
        index = NoteIndex()
        limiter.reset()
        force_reset_capture_job_service_for_tests()
        app.dependency_overrides[get_vault_manager] = lambda: manager
        app.dependency_overrides[get_note_index] = lambda: index

        try:
            client = TestClient(app)
            _require(client.post("/api/vaults", json={"name": "source"}), 201, "create")
            created = _require(
                client.post(
                    "/api/captures",
                    json={
                        "title": "Release drill capture",
                        "body": "Provider-free recovery evidence.",
                        "source": "release-drill",
                        "external_id": "release-drill-1",
                    },
                ),
                201,
                "capture",
            ).json()["capture"]
            queued = _require(
                client.post(
                    "/api/captures/jobs/enqueue",
                    json={"capture_path": created["file_path"]},
                ),
                200,
                "enqueue",
            ).json()

            store = capture_job_store(manager.active_vault_dir())
            claimed = store.claim_next()
            if claimed is None or claimed.id != queued["id"]:
                raise RuntimeError("queued capture could not be claimed")
            failed = store.fail_or_retry(
                claimed.id,
                error="intentional release-drill failure",
                transient=False,
                base_backoff_seconds=0.1,
            )
            retried = _require(
                client.post(f"/api/captures/jobs/{failed.id}/retry"),
                200,
                "retry",
            ).json()

            exported = _require(
                client.get("/api/vaults/source/export"),
                200,
                "export",
            ).content
            rollback = client.post(
                "/api/vaults/source/import?overwrite=true",
                content=b"not-a-tarball",
                headers={"content-type": "application/gzip"},
            )
            if rollback.status_code != 400:
                raise RuntimeError(
                    f"malformed overwrite returned {rollback.status_code}: {rollback.text[:500]}"
                )
            source_captures = _require(
                client.get("/api/captures"), 200, "post-rollback capture check"
            ).json()

            _require(
                client.post(
                    "/api/vaults/restored/import",
                    content=exported,
                    headers={"content-type": "application/gzip"},
                ),
                201,
                "import",
            )
            _require(
                client.put("/api/vaults/active", json={"name": "restored"}),
                200,
                "activate restored vault",
            )
            restored_captures = _require(
                client.get("/api/captures"), 200, "restored capture check"
            ).json()
            restored_jobs = _require(
                client.get("/api/captures/jobs"), 200, "restored job check"
            ).json()

            report = {
                "capture_id": created["id"],
                "failed_status": failed.status,
                "retry_status": retried["status"],
                "retry_attempts_reset": retried["attempts"] == 0,
                "archive_bytes": len(exported),
                "rollback_preserved_capture": any(
                    item["id"] == created["id"] for item in source_captures
                ),
                "restored_capture_present": any(
                    item["id"] == created["id"] for item in restored_captures
                ),
                "restored_jobs_clean": restored_jobs == [],
            }
            report["passed"] = all(
                (
                    report["failed_status"] == "failed",
                    report["retry_status"] == "queued",
                    report["retry_attempts_reset"],
                    report["rollback_preserved_capture"],
                    report["restored_capture_present"],
                    report["restored_jobs_clean"],
                )
            )
            return report
        finally:
            app.dependency_overrides.clear()
            force_reset_capture_job_service_for_tests()


def main() -> None:
    report = run_drill()
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()

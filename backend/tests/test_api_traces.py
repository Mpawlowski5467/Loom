"""Tests for the traces API run endpoints (/api/traces/runs)."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from api.main import app
from core.traces import TraceRecord, get_trace_store


@pytest.fixture()
def client(tmp_path) -> TestClient:
    # The run endpoints read the module-singleton trace store; point it at a
    # temp disk dir and clear it so tests don't see each other's runs.
    store = get_trace_store()
    store.set_disk_dir(tmp_path / "traces")
    store._items.clear()  # test-only reset of the ring buffer
    yield TestClient(app)
    store.set_disk_dir(None)
    store._items.clear()


def _seed_run(run_id: str, agent: str) -> str:
    """Persist a two-step run summary + one in-memory trace for its synth step."""
    store = get_trace_store()
    trace = TraceRecord("p", "m", [], "", "answer", 7, run_id=run_id, step="synthesize")
    store.add(trace)
    store.write_run_summary(
        {
            "run_id": run_id,
            "agent": agent,
            "status": "ok",
            "started": "2026-06-06T10:00:00+00:00",
            "ended": "2026-06-06T10:00:01+00:00",
            "duration_ms": 7,
            "steps": [
                {"name": "search", "status": "ok", "duration_ms": 0, "trace_ids": []},
                {
                    "name": "synthesize",
                    "status": "ok",
                    "duration_ms": 7,
                    "trace_ids": [trace.id],
                },
            ],
        }
    )
    return trace.id


def test_list_runs_returns_summaries(client: TestClient) -> None:
    _seed_run("run_a", "researcher")
    _seed_run("run_b", "standup")

    resp = client.get("/api/traces/runs")
    assert resp.status_code == 200
    runs = resp.json()
    agents = {r["agent"] for r in runs}
    assert {"researcher", "standup"} <= agents
    run_a = next(r for r in runs if r["run_id"] == "run_a")
    assert [s["name"] for s in run_a["steps"]] == ["search", "synthesize"]


def test_get_run_detail_joins_traces(client: TestClient) -> None:
    trace_id = _seed_run("run_c", "researcher")

    resp = client.get("/api/traces/runs/run_c")
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["run_id"] == "run_c"
    # The synthesize step's trace is joined into the detail payload.
    synth_traces = detail["traces"]["synthesize"]
    assert len(synth_traces) == 1
    assert synth_traces[0]["id"] == trace_id
    assert synth_traces[0]["step"] == "synthesize"
    # A no-LLM step has an empty trace list.
    assert detail["traces"]["search"] == []


def test_get_run_detail_404(client: TestClient) -> None:
    assert client.get("/api/traces/runs/nope").status_code == 404


def test_runs_route_not_shadowed_by_trace_id(client: TestClient) -> None:
    # Guard the route ordering: /runs must not be captured by /{trace_id}.
    assert client.get("/api/traces/runs").status_code == 200

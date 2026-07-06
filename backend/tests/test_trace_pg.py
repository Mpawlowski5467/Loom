"""Tests for the Postgres trace mirror. asyncpg is mocked — no live server."""

from __future__ import annotations

import asyncio
import json
import sys
import types
from datetime import UTC, datetime, time, timedelta
from typing import Any

import pytest
from starlette.testclient import TestClient

from api.main import app
from core.trace_pg import _QUEUE_MAX, PgTraceMirror
from core.traces import TraceRecord, TraceStore, get_trace_store

# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class FakeConn:
    def __init__(self, executed: list[tuple[Any, ...]]) -> None:
        self._executed = executed

    async def execute(self, sql: str, *args: Any) -> None:
        self._executed.append((sql, *args))


class FakePool:
    def __init__(self) -> None:
        self.executed: list[tuple[Any, ...]] = []
        self.closed = False

    def acquire(self) -> Any:
        conn = FakeConn(self.executed)

        class _Ctx:
            async def __aenter__(self) -> FakeConn:
                return conn

            async def __aexit__(self, *exc: Any) -> None:
                return None

        return _Ctx()

    async def execute(self, sql: str, *args: Any) -> None:
        self.executed.append((sql, *args))

    async def fetch(self, sql: str, *args: Any) -> list[Any]:
        return []

    async def close(self) -> None:
        self.closed = True


def _run_summary(run_id: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "agent": "researcher",
        "status": "ok",
        "started": "2026-07-05T10:00:00+00:00",
        "ended": "2026-07-05T10:00:01+00:00",
        "duration_ms": 5,
        "steps": [],
    }


def _trace_dict(trace_id: str = "trc_x") -> dict[str, Any]:
    return {
        "id": trace_id,
        "timestamp": "2026-07-05T10:00:00+00:00",
        "provider": "p",
        "model": "m",
        "caller": "c",
        "run_id": "run_1",
        "step": "synthesize",
        "system": "",
        "messages": [{"role": "user", "content": "hi"}],
        "response": "answer",
        "duration_ms": 5,
        "error": "",
    }


# ---------------------------------------------------------------------------
# Write queue
# ---------------------------------------------------------------------------


class TestQueue:
    def test_enqueue_is_non_blocking_and_drops_oldest(self) -> None:
        mirror = PgTraceMirror()
        for i in range(_QUEUE_MAX + 5):
            mirror.enqueue_trace({"id": f"trc_{i}"})

        assert mirror._queue.qsize() == _QUEUE_MAX
        assert mirror.dropped == 5
        # The oldest five entries were discarded; the head is now trc_5.
        kind, payload = mirror._queue.get_nowait()
        assert kind == "trace"
        assert payload["id"] == "trc_5"

    def test_run_summaries_share_the_queue(self) -> None:
        mirror = PgTraceMirror()
        mirror.enqueue_run({"run_id": "run_1", "started": "2026-07-05T10:00:00+00:00"})
        kind, payload = mirror._queue.get_nowait()
        assert kind == "run"
        assert payload["run_id"] == "run_1"

    @pytest.mark.asyncio
    async def test_drain_writes_to_pool(self) -> None:
        mirror = PgTraceMirror()
        pool = FakePool()
        mirror._pool = pool
        mirror.start()
        mirror.enqueue_trace(_trace_dict())
        mirror.enqueue_run({"run_id": "run_1", "started": "2026-07-05T10:00:00+00:00"})

        await asyncio.wait_for(mirror._queue.join(), timeout=5)
        await mirror.aclose()

        sqls = [e[0] for e in pool.executed]
        assert any("INSERT INTO loom_traces" in s for s in sqls)
        assert any("INSERT INTO loom_runs" in s for s in sqls)
        assert pool.closed is True

    @pytest.mark.asyncio
    async def test_init_creates_pool_and_tables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        pool = FakePool()

        async def create_pool(url: str, min_size: int, max_size: int, timeout: float) -> FakePool:
            assert (min_size, max_size) == (1, 4)
            # Bounded connect: an unreachable host must not stall startup for
            # asyncpg's 60s default.
            assert timeout == 5
            return pool

        fake_asyncpg = types.SimpleNamespace(create_pool=create_pool)
        monkeypatch.setitem(sys.modules, "asyncpg", fake_asyncpg)

        mirror = PgTraceMirror()
        assert mirror.connected is False
        await mirror.init("postgresql://loom@localhost/loom")

        assert mirror.connected is True
        sqls = [e[0] for e in pool.executed]
        assert any("CREATE TABLE IF NOT EXISTS loom_traces" in s for s in sqls)
        assert any("CREATE TABLE IF NOT EXISTS loom_runs" in s for s in sqls)
        # Vault-column migration for tables created before the column existed.
        assert any("ADD COLUMN IF NOT EXISTS vault" in s for s in sqls)

    @pytest.mark.asyncio
    async def test_read_failure_returns_empty(self) -> None:
        mirror = PgTraceMirror()

        class ExplodingPool:
            async def fetch(self, sql: str, *args: Any) -> list[Any]:
                raise ConnectionError("pg down")

        mirror._pool = ExplodingPool()
        assert await mirror.list_by_date("2026-07-05", None, 10) == []
        assert await mirror.list_dates() == []
        assert await mirror.get_trace("trc_x") is None
        assert await mirror.traces_for_run("run_1") == []
        assert await mirror.list_runs(10) == []
        assert await mirror.get_run("run_1") is None


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------


class TestPrune:
    @pytest.mark.asyncio
    async def test_prune_deletes_from_both_tables(self) -> None:
        mirror = PgTraceMirror()

        class CountingPool(FakePool):
            async def execute(self, sql: str, *args: Any) -> str:
                await super().execute(sql, *args)
                return "DELETE 3"

        pool = CountingPool()
        mirror._pool = pool

        removed = await mirror.prune(keep_days=30)

        assert removed == 6
        sqls = [e[0] for e in pool.executed]
        assert any("DELETE FROM loom_traces" in s for s in sqls)
        assert any("DELETE FROM loom_runs" in s for s in sqls)
        cutoff = pool.executed[0][1]
        expected = datetime.combine(
            datetime.now(UTC).date() - timedelta(days=30), time.min, tzinfo=UTC
        )
        assert cutoff == expected

    @pytest.mark.asyncio
    async def test_prune_noop_without_pool_or_when_disabled(self) -> None:
        assert await PgTraceMirror().prune(keep_days=30) == 0

        mirror = PgTraceMirror()
        pool = FakePool()
        mirror._pool = pool
        assert await mirror.prune(keep_days=-1) == 0
        assert pool.executed == []

    @pytest.mark.asyncio
    async def test_prune_failure_returns_zero(self) -> None:
        mirror = PgTraceMirror()

        class ExplodingPool:
            async def execute(self, sql: str, *args: Any) -> str:
                raise ConnectionError("pg down")

        mirror._pool = ExplodingPool()
        assert await mirror.prune(keep_days=30) == 0


# ---------------------------------------------------------------------------
# Run reads
# ---------------------------------------------------------------------------


class TestRunReads:
    @pytest.mark.asyncio
    async def test_list_runs_maps_and_skips_bad_rows(self) -> None:
        mirror = PgTraceMirror()
        summary = {"run_id": "run_1", "agent": "researcher", "steps": []}

        class RunPool(FakePool):
            async def fetch(self, sql: str, *args: Any) -> list[Any]:
                assert "FROM loom_runs" in sql
                # jsonb may come back decoded or as text depending on codecs.
                return [
                    {"summary": summary},
                    {"summary": json.dumps(summary)},
                    {"summary": None},
                    {"summary": "not json"},
                ]

        mirror._pool = RunPool()
        runs = await mirror.list_runs(10)
        assert runs == [summary, summary]

    @pytest.mark.asyncio
    async def test_get_run_returns_none_on_miss(self) -> None:
        mirror = PgTraceMirror()
        mirror._pool = FakePool()  # fetch returns []
        assert await mirror.get_run("run_missing") is None


# ---------------------------------------------------------------------------
# TraceStore integration
# ---------------------------------------------------------------------------


class TestTraceStoreMirroring:
    def test_add_enqueues_when_mirror_set(self) -> None:
        store = TraceStore()
        mirror = PgTraceMirror()
        store.set_pg_mirror(mirror)

        record = TraceRecord("p", "m", [], "", "resp", 1)
        store.add(record)

        kind, payload = mirror._queue.get_nowait()
        assert kind == "trace"
        assert payload["id"] == record.id
        # The ring keeps working as before.
        assert store.get(record.id) is record

    def test_add_without_mirror_unchanged(self) -> None:
        store = TraceStore()
        assert store.pg_mirror is None
        record = TraceRecord("p", "m", [], "", "resp", 1)
        store.add(record)  # must not raise, nothing else observable
        assert store.get(record.id) is record

    def test_run_summary_enqueued_even_without_disk_dir(self) -> None:
        store = TraceStore()
        mirror = PgTraceMirror()
        store.set_pg_mirror(mirror)

        store.write_run_summary({"run_id": "run_1", "started": "2026-07-05T10:00:00+00:00"})

        kind, payload = mirror._queue.get_nowait()
        assert kind == "run"
        assert payload["run_id"] == "run_1"


# ---------------------------------------------------------------------------
# Router integration — pg preferred, disk fallback when absent
# ---------------------------------------------------------------------------


class StubMirror:
    """Duck-typed read-side mirror for router tests."""

    def __init__(self) -> None:
        self.traces: dict[str, dict[str, Any]] = {}
        self.runs: dict[str, dict[str, Any]] = {}

    def enqueue_trace(self, record: dict[str, Any]) -> None:
        pass

    def enqueue_run(self, summary: dict[str, Any]) -> None:
        pass

    async def list_by_date(
        self, target_date: str, caller: str | None, limit: int, vault: str | None = None
    ) -> list[dict[str, Any]]:
        return list(self.traces.values())[:limit]

    async def list_dates(self, vault: str | None = None) -> list[str]:
        return ["2026-07-05"] if self.traces else []

    async def get_trace(self, trace_id: str) -> dict[str, Any] | None:
        return self.traces.get(trace_id)

    async def traces_for_run(self, run_id: str) -> list[dict[str, Any]]:
        return [t for t in self.traces.values() if t.get("run_id") == run_id]

    async def list_runs(self, limit: int, vault: str | None = None) -> list[dict[str, Any]]:
        return list(self.runs.values())[:limit]

    async def get_run(self, run_id: str) -> dict[str, Any] | None:
        return self.runs.get(run_id)


@pytest.fixture()
def trace_client(tmp_path) -> TestClient:
    store = get_trace_store()
    store.set_disk_dir(tmp_path / "traces")
    store._items.clear()  # test-only reset of the ring buffer
    yield TestClient(app)
    store.set_disk_dir(None)
    store.set_pg_mirror(None)
    store._items.clear()


class TestRouterFallbacks:
    def test_disk_endpoints_behave_as_today_without_mirror(self, trace_client: TestClient) -> None:
        assert get_trace_store().pg_mirror is None
        assert trace_client.get("/api/traces/disk").json() == []
        assert trace_client.get("/api/traces/disk/dates").json() == {"dates": []}
        assert trace_client.get("/api/traces/trc_missing").status_code == 404

    def test_disk_prefers_pg_when_mirror_has_rows(self, trace_client: TestClient) -> None:
        stub = StubMirror()
        stub.traces["trc_pg"] = _trace_dict("trc_pg")
        get_trace_store().set_pg_mirror(stub)  # type: ignore[arg-type]

        listed = trace_client.get("/api/traces/disk?date=2026-07-05").json()
        assert [t["id"] for t in listed] == ["trc_pg"]
        assert trace_client.get("/api/traces/disk/dates").json() == {"dates": ["2026-07-05"]}

    def test_get_trace_falls_back_to_pg_after_ring_eviction(self, trace_client: TestClient) -> None:
        stub = StubMirror()
        stub.traces["trc_pg"] = _trace_dict("trc_pg")
        get_trace_store().set_pg_mirror(stub)  # type: ignore[arg-type]

        resp = trace_client.get("/api/traces/trc_pg")
        assert resp.status_code == 200
        assert resp.json()["response"] == "answer"

    def test_runs_list_prefers_pg_when_mirror_has_rows(self, trace_client: TestClient) -> None:
        store = get_trace_store()
        store.write_run_summary(_run_summary("run_disk"))
        stub = StubMirror()
        stub.runs["run_pg"] = _run_summary("run_pg")
        store.set_pg_mirror(stub)  # type: ignore[arg-type]

        runs = trace_client.get("/api/traces/runs").json()
        assert [r["run_id"] for r in runs] == ["run_pg"]

    def test_runs_list_falls_back_to_disk_when_pg_empty(self, trace_client: TestClient) -> None:
        store = get_trace_store()
        store.set_pg_mirror(StubMirror())  # type: ignore[arg-type]
        store.write_run_summary(_run_summary("run_disk"))

        runs = trace_client.get("/api/traces/runs").json()
        assert [r["run_id"] for r in runs] == ["run_disk"]

    def test_run_detail_summary_falls_back_to_pg(self, trace_client: TestClient) -> None:
        # The run exists only in Postgres — e.g. its disk file was pruned.
        stub = StubMirror()
        summary = _run_summary("run_pg")
        summary["steps"] = [
            {"name": "synthesize", "status": "ok", "duration_ms": 5, "trace_ids": ["trc_gone"]}
        ]
        stub.runs["run_pg"] = summary
        stub.traces["trc_gone"] = _trace_dict("trc_gone") | {"run_id": "run_pg"}
        get_trace_store().set_pg_mirror(stub)  # type: ignore[arg-type]

        resp = trace_client.get("/api/traces/runs/run_pg")
        assert resp.status_code == 200
        body = resp.json()
        assert body["agent"] == "researcher"
        assert [t["id"] for t in body["traces"]["synthesize"]] == ["trc_gone"]

    def test_run_detail_fills_evicted_steps_from_pg(self, trace_client: TestClient) -> None:
        store = get_trace_store()
        stub = StubMirror()
        stub.traces["trc_gone"] = _trace_dict("trc_gone")
        store.set_pg_mirror(stub)  # type: ignore[arg-type]
        store.write_run_summary(
            {
                "run_id": "run_1",
                "agent": "researcher",
                "status": "ok",
                "started": "2026-07-05T10:00:00+00:00",
                "ended": "2026-07-05T10:00:01+00:00",
                "duration_ms": 5,
                "steps": [
                    {
                        "name": "synthesize",
                        "status": "ok",
                        "duration_ms": 5,
                        "trace_ids": ["trc_gone"],
                    }
                ],
            }
        )

        resp = trace_client.get("/api/traces/runs/run_1")
        assert resp.status_code == 200
        synth = resp.json()["traces"]["synthesize"]
        assert [t["id"] for t in synth] == ["trc_gone"]

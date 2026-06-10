"""Tests for core/traces.py — caller tagging and concurrency safety."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta

import pytest

from core.traces import (
    TraceRecord,
    TraceStore,
    clear_caller,
    clear_run,
    get_caller,
    get_run,
    get_step,
    prune_old_traces,
    set_caller,
    set_run,
    set_step,
)


class TestCallerBasics:
    def test_default_is_empty(self) -> None:
        # Fresh task: no caller set.
        async def check():
            return get_caller()

        assert asyncio.run(check()) == ""

    def test_set_then_get(self) -> None:
        async def check():
            set_caller("weaver")
            return get_caller()

        assert asyncio.run(check()) == "weaver"

    def test_clear(self) -> None:
        async def check():
            set_caller("weaver")
            clear_caller()
            return get_caller()

        assert asyncio.run(check()) == ""


class TestCallerConcurrencyIsolation:
    """The critical property: concurrent coroutines must not see each other's caller.

    Before the ContextVar fix, set_caller/get_caller used threading.local, so
    two coroutines running on the same event-loop thread shared one slot.
    A council fan-out call would read the captures pipeline's "weaver" caller
    mid-flight and tag its own LLM call as caller=weaver even though it was
    a council call for, say, Spider.
    """

    @pytest.mark.asyncio
    async def test_two_tasks_have_independent_callers(self) -> None:
        observed: dict[str, str] = {}

        async def task_a():
            set_caller("alpha")
            # Yield to the scheduler so task_b interleaves while we hold "alpha".
            await asyncio.sleep(0.01)
            observed["a"] = get_caller()

        async def task_b():
            set_caller("beta")
            await asyncio.sleep(0.01)
            observed["b"] = get_caller()

        await asyncio.gather(task_a(), task_b())

        # Each task must see its own caller, not the other's.
        assert observed["a"] == "alpha"
        assert observed["b"] == "beta"

    @pytest.mark.asyncio
    async def test_set_in_spawned_task_does_not_leak_to_parent(self) -> None:
        """A separately-spawned task's set_caller doesn't bleed into the parent.

        ContextVar isolates across asyncio.create_task / gather boundaries,
        but NOT across plain ``await`` (which runs in the same task and so
        shares context). This test exercises the create_task boundary.
        """
        set_caller("parent")

        async def child():
            set_caller("child")
            return get_caller()

        # Spawn as its own task: it gets a copy of the context, mutates its
        # own copy, and the parent's copy is unaffected.
        child_result = await asyncio.create_task(child())
        assert child_result == "child"
        assert get_caller() == "parent"

    @pytest.mark.asyncio
    async def test_interleaved_set_and_chat_simulation(self) -> None:
        """Simulates the original bug: pipeline holds 'weaver' while a council call fires.

        Without ContextVar, the council task would read 'weaver' from the
        shared threading.local slot. With ContextVar, the council task sees
        only its own 'council:spider'.
        """
        captured: list[tuple[str, str]] = []  # (task_name, observed_caller)

        async def pipeline_call():
            set_caller("weaver")
            await asyncio.sleep(0.005)  # simulate slow LLM
            captured.append(("pipeline", get_caller()))
            await asyncio.sleep(0.01)
            captured.append(("pipeline_end", get_caller()))

        async def council_call():
            # A council fan-out call fires while the pipeline is mid-flight.
            await asyncio.sleep(0.002)  # let pipeline set its caller first
            set_caller("council:spider")
            await asyncio.sleep(0.005)
            captured.append(("council", get_caller()))

        await asyncio.gather(pipeline_call(), council_call())

        # The pipeline must keep seeing 'weaver' even though the council
        # task set its own caller in between.
        assert ("pipeline", "weaver") in captured
        assert ("pipeline_end", "weaver") in captured
        assert ("council", "council:spider") in captured


class TestRunStepContext:
    """run_id / step ContextVars used to group flat traces into a run shape."""

    def test_run_default_empty(self) -> None:
        async def check():
            return get_run(), get_step()

        assert asyncio.run(check()) == ("", "")

    def test_set_run_and_step(self) -> None:
        async def check():
            set_run("run_1")
            set_step("search")
            return get_run(), get_step()

        assert asyncio.run(check()) == ("run_1", "search")

    def test_clear_run_also_clears_step(self) -> None:
        async def check():
            set_run("run_1")
            set_step("search")
            clear_run()
            return get_run(), get_step()

        assert asyncio.run(check()) == ("", "")

    def test_trace_record_carries_run_and_step(self) -> None:
        rec = TraceRecord(
            provider="p",
            model="m",
            messages=[],
            system="",
            response="hi",
            duration_ms=5,
            run_id="run_x",
            step="synthesize",
        )
        d = rec.to_dict()
        assert d["run_id"] == "run_x"
        assert d["step"] == "synthesize"

    @pytest.mark.asyncio
    async def test_concurrent_runs_isolated(self) -> None:
        observed: dict[str, str] = {}

        async def task(run_id: str) -> None:
            set_run(run_id)
            await asyncio.sleep(0.01)
            observed[run_id] = get_run()

        await asyncio.gather(task("run_a"), task("run_b"))
        assert observed == {"run_a": "run_a", "run_b": "run_b"}


class TestTraceStoreRuns:
    """The run-summary persistence + by_run join the Runs API depends on."""

    def test_by_run_filters_and_orders(self) -> None:
        store = TraceStore()
        store.add(TraceRecord("p", "m", [], "", "a", 1, run_id="r1", step="search"))
        store.add(TraceRecord("p", "m", [], "", "b", 1, run_id="r2", step="search"))
        store.add(TraceRecord("p", "m", [], "", "c", 1, run_id="r1", step="synthesize"))

        r1 = store.by_run("r1")
        assert [t.response for t in r1] == ["a", "c"]
        assert store.by_run("missing") == []

    def test_write_and_read_run_summary(self, tmp_path) -> None:
        store = TraceStore()
        store.set_disk_dir(tmp_path)
        summary = {
            "run_id": "run_42",
            "agent": "researcher",
            "status": "ok",
            "started": "2026-06-06T10:00:00+00:00",
            "ended": "2026-06-06T10:00:01+00:00",
            "duration_ms": 30,
            "steps": [{"name": "search", "status": "ok", "duration_ms": 30, "trace_ids": []}],
        }
        store.write_run_summary(summary)

        listed = store.list_run_summaries()
        assert len(listed) == 1
        assert listed[0]["run_id"] == "run_42"
        assert store.get_run_summary("run_42")["agent"] == "researcher"
        assert store.get_run_summary("nope") is None

    def test_write_run_summary_noop_without_disk(self) -> None:
        # No disk dir configured → silently skipped, never raises.
        TraceStore().write_run_summary({"run_id": "x", "started": "2026-06-06T00:00:00+00:00"})

    def test_list_run_summaries_keeps_newest_by_mtime_over_limit(self, tmp_path) -> None:
        """With more run files than ``limit``, the most recently *modified* survive.

        Run files are named ``run-<random-hex>.json``, so filenames carry no
        order. Truncation must key on modification time, not filename, or the
        Runs view can silently drop the newest runs.
        """
        date_dir = tmp_path / "2026-06-09"
        date_dir.mkdir()
        # Write 5 run files. Filenames are deliberately *anti*-correlated with
        # recency (older runs get filenames that sort later) to prove the cut
        # ignores filenames.
        base = datetime(2026, 6, 9, 10, 0, 0, tzinfo=UTC)
        files = []
        for age in range(5):  # age 0 = newest run
            name_rank = 4 - age  # newest run gets the lowest filename rank
            path = date_dir / f"run-{name_rank:02d}{'f' * 6}.json"
            started = (base + timedelta(minutes=age)).isoformat()
            path.write_text(json.dumps({"run_id": f"run_{age}", "started": started}))
            files.append((path, age))

        # Stamp mtimes so newer runs are more recently modified.
        now = base.timestamp()
        for path, age in files:
            ts = now + (5 - age)  # age 0 (newest) → largest mtime
            os.utime(path, (ts, ts))

        store = TraceStore()
        store.set_disk_dir(tmp_path)
        listed = store.list_run_summaries(limit=3)

        # The three newest-by-mtime runs (ages 0,1,2) survive the truncation —
        # filenames (anti-correlated with recency) are ignored. The surviving
        # set is the property under test.
        assert {s["run_id"] for s in listed} == {"run_0", "run_1", "run_2"}
        # And they're presented most-recent-first by ``started``: run_2 has the
        # latest start among survivors (age 0's started is earliest by design).
        assert [s["run_id"] for s in listed] == ["run_2", "run_1", "run_0"]


class TestPruneOldTraces:
    """Retention sweep over the on-disk trace store."""

    def _date_dir(self, root, days_ago: int):
        day = (datetime.now(UTC).date() - timedelta(days=days_ago)).isoformat()
        d = root / day
        d.mkdir()
        (d / "trc_x.json").write_text("{}")
        return d

    def test_removes_old_keeps_recent(self, tmp_path) -> None:
        old = self._date_dir(tmp_path, days_ago=40)
        recent = self._date_dir(tmp_path, days_ago=5)

        removed = prune_old_traces(tmp_path, keep_days=30)

        assert removed == 1
        assert not old.exists()
        assert recent.exists()

    def test_ignores_non_date_dirs_and_files(self, tmp_path) -> None:
        # A non-date directory and a stray file must never be touched, even
        # though they may be "old".
        junk_dir = tmp_path / "not-a-date"
        junk_dir.mkdir()
        (junk_dir / "keep.json").write_text("{}")
        stray = tmp_path / "README.md"
        stray.write_text("hi")
        old = self._date_dir(tmp_path, days_ago=99)

        removed = prune_old_traces(tmp_path, keep_days=30)

        assert removed == 1
        assert not old.exists()
        assert junk_dir.exists()
        assert stray.exists()

    def test_missing_dir_returns_zero(self, tmp_path) -> None:
        assert prune_old_traces(tmp_path / "nope", keep_days=30) == 0

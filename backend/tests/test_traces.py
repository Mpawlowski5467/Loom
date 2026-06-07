"""Tests for core/traces.py — caller tagging and concurrency safety."""

from __future__ import annotations

import asyncio

import pytest

from core.traces import (
    TraceRecord,
    TraceStore,
    clear_caller,
    clear_run,
    get_caller,
    get_run,
    get_step,
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

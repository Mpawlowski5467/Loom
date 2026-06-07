"""Tests for the LangGraph capture pipeline: structure, Sentinel-retry loop,
and the recorded run shape.

Parity with the old pipeline is covered by test_pipeline_e2e.py,
test_pipeline_idempotency.py, test_loom_agents.py, and test_api_captures.py
(all of which drive run_pipeline through its public surface). These tests
exercise the graph-specific additions: the conditional Weaver-retry edge and
the run/step trace recording.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.loom.pipeline_graph import build_pipeline_graph
from agents.shuttle.graph_runtime import run_scope
from core.traces import get_trace_store


def _fake_runner():
    """A stand-in AgentRunner exposing only what the graph touches."""
    runner = SimpleNamespace()
    runner._vault_root = Path("/tmp/vault")
    runner._enforce_verdict = MagicMock(
        return_value={"capture_archived": True, "review_required": False, "flagged": False}
    )
    return runner


# A truthy stub chain so the sentinel node uses it directly instead of hitting
# the filesystem fallback (ReadChain.execute) in these unit tests.
_STUB_CHAIN = SimpleNamespace(success=True)


def _note(path: str = "/tmp/vault/threads/topics/n.md"):
    return SimpleNamespace(id="thr_n1", title="N", type="topic", file_path=path)


def _verdict(status: str):
    return SimpleNamespace(status=status, reasons=[], mode_summary="stub")


def _install_agents(monkeypatch, *, weaver, sentinel, spider=None, scribe=None):
    # The graph imports these getters from their source modules at build time,
    # so patch them there rather than on pipeline_graph.
    import agents.loom.scribe as scribe_mod
    import agents.loom.sentinel as sentinel_mod
    import agents.loom.spider as spider_mod
    import agents.loom.weaver as weaver_mod

    monkeypatch.setattr(weaver_mod, "get_weaver", lambda: weaver)
    monkeypatch.setattr(spider_mod, "get_spider", lambda: spider)
    monkeypatch.setattr(scribe_mod, "get_scribe", lambda: scribe)
    monkeypatch.setattr(sentinel_mod, "get_sentinel", lambda: sentinel)


class TestPipelineGraphStructure:
    @pytest.mark.asyncio
    async def test_happy_path_runs_all_steps_once(self, monkeypatch) -> None:
        weaver = MagicMock()
        weaver.process_capture_full = AsyncMock(return_value=(_note(), _STUB_CHAIN))
        sentinel = MagicMock()
        sentinel.validate_action = AsyncMock(return_value=_verdict("passed"))
        _install_agents(monkeypatch, weaver=weaver, sentinel=sentinel)

        runner = _fake_runner()
        graph = build_pipeline_graph(runner)
        async with run_scope("pipeline") as rec:
            final = await graph.ainvoke({"capture_path": "/tmp/vault/threads/captures/c.md"})
            steps = [s.name for s in rec.steps]

        assert steps == ["weaver", "spider", "scribe", "sentinel", "enforce"]
        assert final["capture_archived"] is True
        # Weaver ran exactly once (no retry on a passed verdict).
        assert weaver.process_capture_full.call_count == 1

    @pytest.mark.asyncio
    async def test_empty_capture_short_circuits_to_end(self, monkeypatch) -> None:
        weaver = MagicMock()
        weaver.process_capture_full = AsyncMock(return_value=(None, None))  # empty capture
        sentinel = MagicMock()
        _install_agents(monkeypatch, weaver=weaver, sentinel=sentinel)

        runner = _fake_runner()
        graph = build_pipeline_graph(runner)
        async with run_scope("pipeline") as rec:
            final = await graph.ainvoke({"capture_path": "/tmp/vault/threads/captures/empty.md"})
            steps = [s.name for s in rec.steps]

        # Only weaver ran; spider/scribe/sentinel/enforce never fire.
        assert steps == ["weaver"]
        assert final.get("note") is None
        runner._enforce_verdict.assert_not_called()


class TestSentinelRetryLoop:
    @pytest.mark.asyncio
    async def test_failed_verdict_reruns_weaver_once(self, monkeypatch) -> None:
        weaver = MagicMock()
        weaver.process_capture_full = AsyncMock(return_value=(_note(), _STUB_CHAIN))
        sentinel = MagicMock()
        # First validation fails → retry Weaver; second passes → enforce.
        sentinel.validate_action = AsyncMock(side_effect=[_verdict("failed"), _verdict("passed")])
        _install_agents(monkeypatch, weaver=weaver, sentinel=sentinel)

        runner = _fake_runner()
        graph = build_pipeline_graph(runner)
        async with run_scope("pipeline") as rec:
            await graph.ainvoke({"capture_path": "/tmp/vault/threads/captures/c.md"})
            steps = [s.name for s in rec.steps]

        # The retry shows up as a distinct 'weaver-retry' step, and the whole
        # cycle re-runs once before enforcing.
        assert steps == [
            "weaver",
            "spider",
            "scribe",
            "sentinel",
            "weaver-retry",
            "spider",
            "scribe",
            "sentinel",
            "enforce",
        ]
        assert weaver.process_capture_full.call_count == 2
        assert sentinel.validate_action.call_count == 2

    @pytest.mark.asyncio
    async def test_still_failed_after_retry_stops_and_enforces(self, monkeypatch) -> None:
        weaver = MagicMock()
        weaver.process_capture_full = AsyncMock(return_value=(_note(), _STUB_CHAIN))
        sentinel = MagicMock()
        sentinel.validate_action = AsyncMock(return_value=_verdict("failed"))  # always fails
        runner = _fake_runner()
        runner._enforce_verdict = MagicMock(
            return_value={"capture_archived": False, "review_required": True, "flagged": False}
        )
        _install_agents(monkeypatch, weaver=weaver, sentinel=sentinel)

        graph = build_pipeline_graph(runner)
        async with run_scope("pipeline") as rec:
            final = await graph.ainvoke({"capture_path": "/tmp/vault/threads/captures/c.md"})
            steps = [s.name for s in rec.steps]

        # Exactly one retry, then enforce regardless — no infinite loop.
        assert steps.count("weaver") == 1
        assert steps.count("weaver-retry") == 1
        assert steps[-1] == "enforce"
        assert weaver.process_capture_full.call_count == 2  # initial + one retry
        assert final["review_required"] is True
        assert final["capture_archived"] is False


class TestRunShapeRecording:
    @pytest.mark.asyncio
    async def test_sentinel_llm_call_attributed_to_step(self, monkeypatch) -> None:
        """A run summary is persisted with the pipeline's step shape, and the
        sentinel LLM call is grouped under the run."""
        get_trace_store().set_disk_dir(None)  # in-memory only for this unit test

        weaver = MagicMock()
        weaver.process_capture_full = AsyncMock(return_value=(_note(), _STUB_CHAIN))

        # Sentinel records a trace under the active run/step when it validates.
        from core.traces import TraceRecord, get_run, get_step

        async def _validate(*args, **kwargs):
            get_trace_store().add(
                TraceRecord("p", "m", [], "", "ok", 2, run_id=get_run(), step=get_step())
            )
            return _verdict("passed")

        sentinel = MagicMock()
        sentinel.validate_action = AsyncMock(side_effect=_validate)
        _install_agents(monkeypatch, weaver=weaver, sentinel=sentinel)

        runner = _fake_runner()
        graph = build_pipeline_graph(runner)
        async with run_scope("pipeline") as rec:
            await graph.ainvoke({"capture_path": "/tmp/vault/threads/captures/c.md"})
            summary = rec.summary()

        assert summary["agent"] == "pipeline"
        sentinel_step = next(s for s in summary["steps"] if s["name"] == "sentinel")
        assert len(sentinel_step["trace_ids"]) == 1
        trace = get_trace_store().get(sentinel_step["trace_ids"][0])
        assert trace is not None and trace.step == "sentinel"

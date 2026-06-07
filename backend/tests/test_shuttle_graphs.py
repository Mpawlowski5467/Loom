"""Tests for the LangGraph Shuttle-agent graphs and run-trace bridge.

These complement test_shuttle_agents.py (which proves behavior parity through
the public query()/generate() API) by exercising the graph structure directly:
conditional routing, the recorded run shape (including no-LLM steps), and the
run_id/step trace grouping.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
import yaml

from agents.changelog import log_action
from agents.shuttle.graph_runtime import run_scope, step
from agents.shuttle.researcher import Researcher
from agents.shuttle.researcher_graph import build_researcher_graph
from agents.shuttle.standup import Standup
from agents.shuttle.standup_graph import build_standup_graph
from core.notes import build_frontmatter, now_iso
from core.traces import TraceRecord, get_trace_store


def _setup_vault(tmp_path: Path) -> Path:
    root = tmp_path / "vault"
    root.mkdir()
    (root / "vault.yaml").write_text(yaml.safe_dump({"name": "test"}), encoding="utf-8")
    rules = root / "rules"
    rules.mkdir()
    (rules / "prime.md").write_text("# Prime\n\nBe good.\n", encoding="utf-8")

    for agent_name in ["researcher", "standup"]:
        agent_dir = root / "agents" / agent_name
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text(
            yaml.safe_dump(
                {
                    "name": agent_name,
                    "enabled": True,
                    "trust_level": "standard",
                    "memory_threshold": 100,
                }
            ),
            encoding="utf-8",
        )
        (agent_dir / "memory.md").write_text("# Memory\n\nEmpty.\n", encoding="utf-8")
        (agent_dir / "state.json").write_text(
            json.dumps({"action_count": 0, "last_action": None}), encoding="utf-8"
        )
        (agent_dir / "logs").mkdir()
        (root / ".loom" / "changelog" / agent_name).mkdir(parents=True, exist_ok=True)

    for folder in ["daily", "projects", "topics", "people", "captures", ".archive"]:
        (root / "threads" / folder).mkdir(parents=True, exist_ok=True)

    ts = now_iso()
    note = root / "threads" / "topics" / "caching.md"
    note.write_text(
        build_frontmatter(
            {
                "id": "thr_cache0",
                "title": "Caching",
                "type": "topic",
                "tags": ["caching"],
                "created": ts,
                "modified": ts,
                "author": "user",
                "status": "active",
                "history": [],
            }
        )
        + "\n## Summary\n\nCaching overview.\n",
        encoding="utf-8",
    )
    return root


# ── graph_runtime ───────────────────────────────────────────────────────────


class TestGraphRuntime:
    @pytest.mark.asyncio
    async def test_run_scope_records_steps_including_no_llm(self, tmp_path) -> None:
        get_trace_store().set_disk_dir(tmp_path)
        async with run_scope("researcher") as rec:
            async with step("search"):
                pass
            async with step("save"):
                pass
            summary = rec.summary()

        assert summary["agent"] == "researcher"
        assert [s["name"] for s in summary["steps"]] == ["search", "save"]
        # No-LLM steps are still present with empty trace_ids.
        assert all(s["trace_ids"] == [] for s in summary["steps"])
        # Summary was persisted to disk.
        assert get_trace_store().get_run_summary(summary["run_id"]) is not None

    @pytest.mark.asyncio
    async def test_step_attributes_traces_to_run_and_step(self, tmp_path) -> None:
        get_trace_store().set_disk_dir(tmp_path)
        async with run_scope("researcher") as rec:
            run_id = rec.run_id
            async with step("synthesize"):
                # Simulate a provider call recording a trace under the active run/step.
                from core.traces import get_run, get_step

                get_trace_store().add(
                    TraceRecord("p", "m", [], "", "ans", 3, run_id=get_run(), step=get_step())
                )
            summary = rec.summary()

        traces = get_trace_store().by_run(run_id)
        assert len(traces) == 1
        assert traces[0].step == "synthesize"
        # The step record links the trace id.
        synth = next(s for s in summary["steps"] if s["name"] == "synthesize")
        assert synth["trace_ids"] == [traces[0].id]

    @pytest.mark.asyncio
    async def test_step_error_marks_status_and_reraises(self, tmp_path) -> None:
        get_trace_store().set_disk_dir(tmp_path)
        with pytest.raises(ValueError):
            async with run_scope("researcher") as rec:
                async with step("boom"):
                    raise ValueError("kaboom")
        assert rec.summary()["status"] == "error"
        assert rec.summary()["steps"][0]["status"] == "error"


# ── Researcher graph ─────────────────────────────────────────────────────────


class TestResearcherGraph:
    @pytest.mark.asyncio
    async def test_graph_runs_all_steps(self, tmp_path) -> None:
        root = _setup_vault(tmp_path)
        get_trace_store().set_disk_dir(root / ".loom" / "traces")
        researcher = Researcher(root, chat_provider=None)

        result = await researcher.query("caching")

        assert result.answer
        assert result.capture_id.startswith("thr_")
        # A run summary with the three Researcher steps was recorded.
        runs = get_trace_store().list_run_summaries()
        latest = next(r for r in runs if r["agent"] == "researcher")
        assert [s["name"] for s in latest["steps"]] == ["search", "synthesize", "save"]

    @pytest.mark.asyncio
    async def test_graph_llm_call_tagged_with_run_and_step(self, tmp_path) -> None:
        """End-to-end through the real TracedProvider: the synthesize step's
        LLM call is recorded and grouped under the run, tagged step=synthesize."""
        root = _setup_vault(tmp_path)
        get_trace_store().set_disk_dir(root / ".loom" / "traces")

        from core.providers.base import BaseProvider
        from core.providers.registry import TracedProvider

        class _StubProvider(BaseProvider):
            name = "stub"
            chat_model = "stub-model"

            async def embed(self, text: str) -> list[float]:
                return [0.0]

            async def chat(self, messages, system: str = "") -> str:
                return "Synthesized answer."

        provider = TracedProvider(_StubProvider(), "stub")
        researcher = Researcher(root, chat_provider=provider)

        await researcher.query("caching")

        runs = get_trace_store().list_run_summaries()
        latest = next(r for r in runs if r["agent"] == "researcher")
        synth = next(s for s in latest["steps"] if s["name"] == "synthesize")
        assert len(synth["trace_ids"]) == 1
        # The recorded trace carries the run id and the synthesize step.
        trace = get_trace_store().get(synth["trace_ids"][0])
        assert trace is not None
        assert trace.run_id == latest["run_id"]
        assert trace.step == "synthesize"


# ── Standup graph (conditional routing) ──────────────────────────────────────


class TestStandupGraph:
    @pytest.mark.asyncio
    async def test_active_day_routes_through_generate(self, tmp_path) -> None:
        root = _setup_vault(tmp_path)
        get_trace_store().set_disk_dir(root / ".loom" / "traces")
        log_action(root, "weaver", "created", "test.md")
        standup = Standup(root, chat_provider=None)

        result = await standup.generate()

        assert result.recap
        runs = get_trace_store().list_run_summaries()
        latest = next(r for r in runs if r["agent"] == "standup")
        names = [s["name"] for s in latest["steps"]]
        assert names == ["collect", "generate", "save"]
        assert "skip" not in names

    @pytest.mark.asyncio
    async def test_idle_day_routes_to_skip(self, tmp_path) -> None:
        root = _setup_vault(tmp_path)
        get_trace_store().set_disk_dir(root / ".loom" / "traces")
        standup = Standup(root, chat_provider=None)

        result = await standup.generate(date(2020, 1, 1))

        assert result.recap == ""
        runs = get_trace_store().list_run_summaries()
        latest = next(r for r in runs if r["agent"] == "standup")
        names = [s["name"] for s in latest["steps"]]
        # Conditional edge takes the skip branch — generate/save never run.
        assert names == ["collect", "skip"]

    @pytest.mark.asyncio
    async def test_build_graphs_compile(self, tmp_path) -> None:
        # Smoke: both builders return a compiled graph without a live vault.
        root = _setup_vault(tmp_path)
        assert build_researcher_graph(Researcher(root, None)) is not None
        assert build_standup_graph(Standup(root, None), date(2026, 6, 6)) is not None

"""Shared LangGraph runtime helpers for Shuttle-layer agents.

The Shuttle agents (Researcher, Standup) are expressed as small LangGraph
``StateGraph``s. This module holds the glue that is common to both:

- :class:`RunRecorder` — tracks the ordered *shape* of a graph run (its steps,
  their status and duration, and which LLM traces each produced) so the run can
  be reified into a summary even for steps that make no LLM call.
- :func:`step` — an async context manager every node enters; it sets the
  trace ``step`` ContextVar (so child provider calls are attributed to the step)
  and records timing/status into the active :class:`RunRecorder`.

Nodes call Loom's own ``BaseProvider`` directly — no LangChain model objects.
"""

from __future__ import annotations

import contextvars
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from core.notes import generate_id, now_iso
from core.traces import (
    clear_run,
    get_caller,
    get_trace_store,
    set_caller,
    set_run,
    set_step,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@dataclass
class StepRecord:
    """One node's execution within a run."""

    name: str
    status: str = "ok"  # "ok" | "error"
    duration_ms: int = 0
    trace_ids: list[str] = field(default_factory=list)
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "duration_ms": self.duration_ms,
            "trace_ids": self.trace_ids,
            "error": self.error,
        }


@dataclass
class RunRecorder:
    """Accumulates the ordered steps of a single graph run.

    Each :class:`RunRecorder` owns a ``run_id`` and is bound to the current task
    via a ContextVar for the duration of :func:`run_scope`, so nodes anywhere in
    the graph can reach it without threading it through graph state.
    """

    agent: str
    run_id: str = field(default_factory=generate_id)
    started: str = field(default_factory=now_iso)
    ended: str = ""
    steps: list[StepRecord] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        """Render the run summary persisted next to traces."""
        status = "error" if any(s.status == "error" for s in self.steps) else "ok"
        return {
            "run_id": self.run_id,
            "agent": self.agent,
            "status": status,
            "started": self.started,
            "ended": self.ended or now_iso(),
            "duration_ms": sum(s.duration_ms for s in self.steps),
            "steps": [s.to_dict() for s in self.steps],
        }


_recorder_var: contextvars.ContextVar[RunRecorder | None] = contextvars.ContextVar(
    "loom_run_recorder", default=None
)


def current_recorder() -> RunRecorder | None:
    return _recorder_var.get()


@asynccontextmanager
async def run_scope(agent: str) -> AsyncIterator[RunRecorder]:
    """Open a run: bind a fresh :class:`RunRecorder`, tag traces with its id,
    and persist the summary on exit.

    On exit the run id/step ContextVars are cleared and the summary is written
    to the trace store's disk dir (a no-op when none is configured).
    """
    recorder = RunRecorder(agent=agent)
    rec_token = _recorder_var.set(recorder)
    set_run(recorder.run_id)
    try:
        yield recorder
    finally:
        recorder.ended = now_iso()
        try:
            get_trace_store().write_run_summary(recorder.summary())
        finally:
            clear_run()
            _recorder_var.reset(rec_token)


@asynccontextmanager
async def step(name: str, caller: str | None = None) -> AsyncIterator[StepRecord]:
    """Enter a graph node: tag its provider calls with ``name`` and record its
    timing, status, and any LLM traces into the active run.

    Captures traces produced *during* the step by snapshotting the run's trace
    ids before and after, so even a step that fans out several calls is
    attributed correctly. A step that raises is recorded as ``error`` and the
    exception re-raised so LangGraph can route on it.

    ``caller`` optionally sets the trace caller for the duration of the step
    (and restores the prior one on exit). The Loom pipeline uses this so its
    steps keep the per-agent caller attribution the flat-trace view and the
    activity pulse rely on; the Shuttle graphs omit it because their
    ``execute_with_chain`` wrapper already owns the caller.
    """
    record = StepRecord(name=name)
    recorder = _recorder_var.get()
    if recorder is not None:
        recorder.steps.append(record)
    set_step(name)

    prior_caller: str | None = None
    if caller is not None:
        prior_caller = get_caller()
        set_caller(caller)

    store = get_trace_store()
    run_id = recorder.run_id if recorder is not None else ""
    before = {t.id for t in store.by_run(run_id)} if run_id else set()

    start = time.perf_counter()
    try:
        yield record
    except Exception as exc:
        record.status = "error"
        record.error = str(exc)
        raise
    finally:
        record.duration_ms = int((time.perf_counter() - start) * 1000)
        set_step("")
        if prior_caller is not None:
            set_caller(prior_caller)
        if run_id:
            record.trace_ids = [t.id for t in store.by_run(run_id) if t.id not in before]

"""Loom capture-processing pipeline as a LangGraph StateGraph.

Models the full capture→note pipeline:

    weaver → spider → scribe → sentinel → (conditional)
                                   ├─ failed & not retried → weaver (retry once)
                                   └─ else                  → enforce → END

Each node wraps an existing Loom agent method (logic is reused, not rewritten)
and runs inside a :func:`step` scope so its LLM calls are attributed to the
step and the run's shape lands in the Runs observability view.

The Sentinel-retry loop is the conditional edge: a ``failed`` verdict routes
back to Weaver once to regenerate the note, then re-validates. If it still
fails, the capture stays in the inbox flagged for review (the prior behavior,
preserved as the floor). Nodes call Loom's own agents/providers — no LangChain
model objects.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.shuttle.graph_runtime import step

if TYPE_CHECKING:
    from pathlib import Path

    from langgraph.graph.state import CompiledStateGraph

    from agents.loom.sentinel import ValidationResult

logger = logging.getLogger(__name__)

_MAX_WEAVER_RETRIES = 1


class PipelineState(TypedDict, total=False):
    """State threaded through the capture-pipeline nodes.

    ``note`` / ``chain`` / ``validation`` are typed ``Any`` because LangGraph
    evaluates these annotations at graph-build time (via ``get_type_hints``),
    and the real classes (Note, ReadChainResult, ValidationResult) are only
    imported under ``TYPE_CHECKING`` to avoid runtime import cycles. They are
    plain pass-through channels, so the concrete type is irrelevant to LangGraph.
    """

    capture_path: str
    note: Any  # core.notes.Note | None
    chain: Any  # agents.chain.ReadChainResult | None
    note_path: str
    linked: list[str]
    suggested: list[str]
    index_updated: bool
    validation: Any  # agents.loom.sentinel.ValidationResult | None
    weaver_attempts: int
    errors: list[str]
    capture_archived: bool
    review_required: bool
    flagged: bool


def build_pipeline_graph(runner: Any, refresh_index: Any = None) -> CompiledStateGraph:
    """Compile the capture pipeline bound to a concrete :class:`AgentRunner`.

    ``refresh_index`` is an optional ``Callable[[Path], None]`` used by the live
    endpoint to keep the search index hot after writes; omitted in batch runs.
    """
    from agents.loom.scribe import get_scribe
    from agents.loom.sentinel import get_sentinel
    from agents.loom.spider import get_spider
    from agents.loom.weaver import get_weaver

    def _resolve(p: str) -> Path:
        from pathlib import Path

        return Path(p)

    async def weaver_node(state: PipelineState) -> PipelineState:
        attempts = state.get("weaver_attempts", 0)
        errors = list(state.get("errors", []))
        label = "weaver" if attempts == 0 else "weaver-retry"
        async with step(label, caller="weaver"):
            weaver = get_weaver()
            if weaver is None:
                errors.append("Weaver agent not initialized")
                return {"note": None, "errors": errors, "weaver_attempts": attempts + 1}
            try:
                note, chain = await weaver.process_capture_full(_resolve(state["capture_path"]))
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Weaver failed during pipeline run", exc_info=True)
                errors.append(f"Weaver failed: {exc}")
                return {"note": None, "errors": errors, "weaver_attempts": attempts + 1}
        if note is None:
            # Empty capture is a clean skip, not an error — leave errors as-is
            # so the endpoint reports "Empty capture, skipped".
            return {"note": None, "errors": errors, "weaver_attempts": attempts + 1}
        if refresh_index is not None:
            refresh_index(_resolve(note.file_path))
        return {
            "note": note,
            "chain": chain,
            "note_path": note.file_path,
            "weaver_attempts": attempts + 1,
            "errors": errors,
        }

    async def spider_node(state: PipelineState) -> PipelineState:
        errors = list(state.get("errors", []))
        linked: list[str] = []
        suggested: list[str] = []
        async with step("spider", caller="spider"):
            spider = get_spider()
            if spider is not None:
                try:
                    report = await spider.scan_and_report(_resolve(state["note_path"]))
                    linked = list(report.auto_linked)
                    suggested = list(report.suggested)
                    if refresh_index is not None:
                        refresh_index(_resolve(state["note_path"]))
                except Exception as exc:
                    logger.warning("Spider failed during pipeline run", exc_info=True)
                    errors.append(f"Spider failed: {exc}")
        return {"linked": linked, "suggested": suggested, "errors": errors}

    async def scribe_node(state: PipelineState) -> PipelineState:
        errors = list(state.get("errors", []))
        updated = False
        async with step("scribe", caller="scribe"):
            scribe = get_scribe()
            if scribe is not None:
                try:
                    await scribe.update_index(_resolve(state["note_path"]).parent)
                    updated = True
                except Exception as exc:
                    logger.warning("Scribe failed during pipeline run", exc_info=True)
                    errors.append(f"Scribe failed: {exc}")
        return {"index_updated": updated, "errors": errors}

    async def sentinel_node(state: PipelineState) -> PipelineState:
        errors = list(state.get("errors", []))
        validation: ValidationResult | None = None
        async with step("sentinel", caller="sentinel"):
            sentinel = get_sentinel()
            if sentinel is not None:
                try:
                    chain = state.get("chain")
                    if chain is None:
                        from agents.chain import ReadChain

                        rc = ReadChain(runner._vault_root)
                        chain = await asyncio.to_thread(
                            rc.execute, "sentinel", _resolve(state["note_path"])
                        )
                    validation = await sentinel.validate_action(
                        "weaver", "created", _resolve(state["note_path"]), chain
                    )
                except Exception as exc:
                    logger.warning("Sentinel failed during pipeline run", exc_info=True)
                    errors.append(f"Sentinel failed: {exc}")
        return {"validation": validation, "errors": errors}

    def route_after_weaver(state: PipelineState) -> str:
        """Short-circuit to END when Weaver produced no note (empty capture or
        init failure) — there is nothing to link, index, validate, or archive."""
        return "spider" if state.get("note") is not None else "end"

    def route_after_sentinel(state: PipelineState) -> str:
        """Loop back to Weaver once on a failed verdict, else enforce."""
        validation = state.get("validation")
        verdict = validation.status if validation else ""
        if verdict == "failed" and state.get("weaver_attempts", 0) <= _MAX_WEAVER_RETRIES:
            return "weaver"
        return "enforce"

    async def enforce_node(state: PipelineState) -> PipelineState:
        """Sentinel enforcement: archive unless failed; annotate accordingly."""
        errors = list(state.get("errors", []))
        async with step("enforce"):
            flags = runner._enforce_verdict(
                _resolve(state["capture_path"]),
                _resolve(state["note_path"]) if state.get("note_path") else None,
                state.get("validation"),
                errors,
            )
        return {"errors": errors, **flags}

    graph: StateGraph = StateGraph(PipelineState)
    graph.add_node("weaver", weaver_node)
    graph.add_node("spider", spider_node)
    graph.add_node("scribe", scribe_node)
    graph.add_node("sentinel", sentinel_node)
    graph.add_node("enforce", enforce_node)
    graph.add_edge(START, "weaver")
    graph.add_conditional_edges("weaver", route_after_weaver, {"spider": "spider", "end": END})
    graph.add_edge("spider", "scribe")
    graph.add_edge("scribe", "sentinel")
    graph.add_conditional_edges(
        "sentinel", route_after_sentinel, {"weaver": "weaver", "enforce": "enforce"}
    )
    graph.add_edge("enforce", END)
    return graph.compile()

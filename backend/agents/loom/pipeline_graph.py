"""Loom capture-processing pipeline as a LangGraph StateGraph.

Models the full capture→note pipeline:

    weaver → sentinel → (conditional)
                  ├─ failed & not retried → weaver (retry once)
                  ├─ passed/warning       → spider → scribe → enforce → END
                  └─ unavailable/other    → enforce → END

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


def build_pipeline_graph(
    runner: Any, refresh_index: Any = None
) -> CompiledStateGraph[PipelineState]:
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
        # The prior attempt's note (set on a Sentinel-retry). Retired below once
        # the retry produces a replacement, so one capture never leaves two
        # active notes both tagged source: capture:<id>.
        prev_note_path = state.get("note_path")
        label = "weaver" if attempts == 0 else "weaver-retry"
        async with step(label, caller="weaver") as record:
            weaver = get_weaver()
            if weaver is None:
                message = "Weaver agent not initialized"
                errors.append(message)
                record.status = "error"
                record.error = message
                return {"note": None, "errors": errors, "weaver_attempts": attempts + 1}
            try:
                note, chain = await weaver.process_capture_full(_resolve(state["capture_path"]))
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Weaver failed during pipeline run", exc_info=True)
                message = f"Weaver failed: {exc}"
                errors.append(message)
                record.status = "error"
                record.error = message
                return {"note": None, "errors": errors, "weaver_attempts": attempts + 1}
        if note is None:
            # Empty capture is a clean skip, not an error — leave errors as-is
            # so the endpoint reports "Empty capture, skipped". On a *retry* that
            # failed to regenerate, the prior note_path/verdict survive in state
            # and route_after_weaver sends us to enforce (see there).
            return {"note": None, "errors": errors, "weaver_attempts": attempts + 1}
        # Successful retry → archive the rejected first-attempt note.
        if attempts > 0 and prev_note_path and prev_note_path != note.file_path:
            try:
                from agents.loom.weaver_io import archive_note

                await asyncio.to_thread(
                    archive_note,
                    runner._vault_root,
                    "weaver",
                    _resolve(prev_note_path),
                    "Superseded by Sentinel-retry regeneration",
                )
            except Exception:  # noqa: BLE001 - archiving the orphan is best-effort
                logger.warning(
                    "Failed to archive superseded note %s", prev_note_path, exc_info=True
                )
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
        async with step("spider", caller="spider") as record:
            spider = get_spider()
            try:
                # The draft is indexed only after Sentinel explicitly approves
                # it. Failed/unavailable drafts never reach this node.
                if refresh_index is not None:
                    refresh_index(_resolve(state["note_path"]))
                if spider is not None:
                    report = await spider.scan_and_report(_resolve(state["note_path"]))
                    linked = list(report.auto_linked)
                    suggested = list(report.suggested)
                    if refresh_index is not None:
                        refresh_index(_resolve(state["note_path"]))
            except Exception as exc:
                logger.warning("Spider failed during pipeline run", exc_info=True)
                message = f"Spider failed: {exc}"
                errors.append(message)
                record.status = "error"
                record.error = message
        return {"linked": linked, "suggested": suggested, "errors": errors}

    async def scribe_node(state: PipelineState) -> PipelineState:
        errors = list(state.get("errors", []))
        updated = False
        async with step("scribe", caller="scribe") as record:
            scribe = get_scribe()
            if scribe is not None:
                try:
                    await scribe.update_index(_resolve(state["note_path"]).parent)
                    updated = True
                except Exception as exc:
                    logger.warning("Scribe failed during pipeline run", exc_info=True)
                    message = f"Scribe failed: {exc}"
                    errors.append(message)
                    record.status = "error"
                    record.error = message
        return {"index_updated": updated, "errors": errors}

    async def sentinel_node(state: PipelineState) -> PipelineState:
        errors = list(state.get("errors", []))
        validation: ValidationResult | None = None
        async with step("sentinel", caller="sentinel") as record:
            sentinel = get_sentinel()
            if sentinel is None:
                from agents.loom.sentinel import ValidationResult

                message = "Sentinel agent not initialized"
                errors.append(message)
                record.status = "error"
                record.error = message
                validation = ValidationResult(
                    status="unavailable",
                    reasons=[message],
                    agent_name="weaver",
                    action="created",
                    target=state.get("note_path", ""),
                    modes=["unavailable"],
                )
            else:
                try:
                    chain = state.get("chain")
                    if chain is None:
                        from agents.chain import ReadChain

                        rc = ReadChain(runner._vault_root)
                        chain = await asyncio.to_thread(
                            rc.execute, "sentinel", _resolve(state["note_path"])
                        )
                    # Narrow for validate_action: chain is freshly resolved above.
                    assert chain is not None
                    validation = await sentinel.validate_action(
                        "weaver", "created", _resolve(state["note_path"]), chain
                    )
                except Exception as exc:
                    logger.warning("Sentinel failed during pipeline run", exc_info=True)
                    from agents.loom.sentinel import ValidationResult

                    message = f"Sentinel failed: {exc}"
                    errors.append(message)
                    record.status = "error"
                    record.error = message
                    validation = ValidationResult(
                        status="unavailable",
                        reasons=[message],
                        agent_name="weaver",
                        action="created",
                        target=state.get("note_path", ""),
                        modes=["unavailable"],
                    )
        return {"validation": validation, "errors": errors}

    def route_after_weaver(state: PipelineState) -> str:
        """Route after Weaver.

        - Note produced → validate with Sentinel before downstream mutations.
        - No note on the *first* attempt (empty capture / init failure) → END;
          there's nothing to link, index, validate, or archive.
        - No note on a *retry* (Weaver failed to regenerate) → enforce: the
          prior attempt's note and its failed verdict are still in state, so
          enforce flags the capture review_required instead of leaving it in
          limbo (enforce must always run on the retry path).
        """
        if state.get("note") is not None:
            return "sentinel"
        if state.get("weaver_attempts", 0) > 1 and state.get("note_path"):
            return "enforce"
        return "end"

    def route_after_sentinel(state: PipelineState) -> str:
        """Retry failed drafts once; publish only explicit pass/warning verdicts."""
        validation = state.get("validation")
        verdict = validation.status if validation else ""
        if verdict == "failed" and state.get("weaver_attempts", 0) <= _MAX_WEAVER_RETRIES:
            return "weaver"
        if verdict in {"passed", "warning"}:
            return "spider"
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
        return {
            "errors": errors,
            "capture_archived": flags["capture_archived"],
            "review_required": flags["review_required"],
            "flagged": flags["flagged"],
        }

    graph: StateGraph[PipelineState] = StateGraph(PipelineState)
    graph.add_node("weaver", weaver_node)
    graph.add_node("spider", spider_node)
    graph.add_node("scribe", scribe_node)
    graph.add_node("sentinel", sentinel_node)
    graph.add_node("enforce", enforce_node)
    graph.add_edge(START, "weaver")
    graph.add_conditional_edges(
        "weaver",
        route_after_weaver,
        {"sentinel": "sentinel", "enforce": "enforce", "end": END},
    )
    graph.add_conditional_edges(
        "sentinel",
        route_after_sentinel,
        {"weaver": "weaver", "spider": "spider", "enforce": "enforce"},
    )
    graph.add_edge("spider", "scribe")
    graph.add_edge("scribe", "enforce")
    graph.add_edge("enforce", END)
    return graph.compile()

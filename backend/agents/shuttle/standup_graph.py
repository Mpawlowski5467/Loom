"""Standup agent as a LangGraph StateGraph.

Flow ``collect → (conditional) → generate → save``. The conditional edge after
``collect`` demonstrates real routing: when there is no activity for the day it
routes straight to ``END`` (preserving the old early-exit), otherwise it
proceeds to ``generate``. Each node wraps an existing ``Standup`` method.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.shuttle.graph_runtime import step

if TYPE_CHECKING:
    from datetime import date

    from langgraph.graph.state import CompiledStateGraph

    from agents.shuttle.standup import Standup


class StandupState(TypedDict, total=False):
    """Graph state threaded through the Standup nodes."""

    date_str: str
    changelog_text: str
    notes_text: str
    notes_modified: int
    recap: str
    capture_id: str
    capture_path: str
    skipped: bool


def build_standup_graph(agent: Standup, target_date: date) -> CompiledStateGraph[StandupState]:
    """Compile the Standup graph bound to a concrete agent and target date."""

    async def collect(state: StandupState) -> StandupState:
        async with step("collect"):
            changelog_text = agent._collect_changelog(target_date)
            modified_notes = agent._find_modified_notes(target_date)
        notes_text = "\n".join(f"- [[{n['title']}]] ({n['type']})" for n in modified_notes)
        return {
            "changelog_text": changelog_text,
            "notes_text": notes_text,
            "notes_modified": len(modified_notes),
        }

    def route_after_collect(state: StandupState) -> str:
        """Route to END when the day had no activity, else to generate."""
        if not state.get("changelog_text", "").strip() and not state.get("notes_modified"):
            return "skip"
        return "generate"

    async def skip(state: StandupState) -> StandupState:
        async with step("skip"):
            pass
        return {"skipped": True, "recap": ""}

    async def generate(state: StandupState) -> StandupState:
        async with step("generate"):
            recap = await agent._generate_recap(
                state["date_str"],
                state.get("changelog_text", ""),
                state.get("notes_text", ""),
            )
        return {"recap": recap}

    async def save(state: StandupState) -> StandupState:
        async with step("save"):
            capture_id, capture_path = agent._save_capture(
                state["date_str"], state.get("recap", "")
            )
        return {"capture_id": capture_id, "capture_path": str(capture_path)}

    graph: StateGraph[StandupState] = StateGraph(StandupState)
    graph.add_node("collect", collect)
    graph.add_node("skip", skip)
    graph.add_node("generate", generate)
    graph.add_node("save", save)
    graph.add_edge(START, "collect")
    graph.add_conditional_edges(
        "collect", route_after_collect, {"skip": "skip", "generate": "generate"}
    )
    graph.add_edge("skip", END)
    graph.add_edge("generate", "save")
    graph.add_edge("save", END)
    return graph.compile()

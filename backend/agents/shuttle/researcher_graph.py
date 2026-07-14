"""Researcher agent as a LangGraph StateGraph.

Flow ``search → synthesize → (optional) save``. Each node wraps an existing
``Researcher`` method (logic is reused, not rewritten) and runs inside a
:func:`step` scope so its LLM calls are attributed to the step and the run's
shape is recorded for the Runs observability view.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.chain import ReadChainResult
from agents.shuttle.graph_runtime import step

if TYPE_CHECKING:
    from langgraph.graph.state import CompiledStateGraph

    from agents.shuttle.researcher import Researcher


class ResearcherState(TypedDict, total=False):
    """Graph state threaded through the Researcher nodes."""

    question: str
    chain: ReadChainResult
    save_capture: bool
    vault_context: str
    refs: list[dict[str, Any]]
    answer: str
    capture_id: str
    capture_path: str


def build_researcher_graph(agent: Researcher) -> CompiledStateGraph[ResearcherState]:
    """Compile the Researcher graph bound to a concrete agent instance."""

    async def search(state: ResearcherState) -> ResearcherState:
        async with step("search"):
            vault_context, refs = await agent._search_vault(state["question"])
        return {"vault_context": vault_context, "refs": refs}

    async def synthesize(state: ResearcherState) -> ResearcherState:
        async with step("synthesize"):
            answer = await agent._synthesize(
                state["question"], state.get("vault_context", ""), state["chain"]
            )
        return {"answer": agent._ground_answer_wikilinks(answer, state.get("refs", []))}

    def route_after_synthesize(state: ResearcherState) -> str:
        return "save" if state.get("save_capture", True) else "done"

    async def save(state: ResearcherState) -> ResearcherState:
        async with step("save"):
            capture_id, capture_path = await agent._save_capture(
                state["question"], state.get("answer", ""), state.get("refs", [])
            )
        return {"capture_id": capture_id, "capture_path": str(capture_path)}

    graph: StateGraph[ResearcherState] = StateGraph(ResearcherState)
    graph.add_node("search", search)
    graph.add_node("synthesize", synthesize)
    graph.add_node("save", save)
    graph.add_edge(START, "search")
    graph.add_edge("search", "synthesize")
    graph.add_conditional_edges("synthesize", route_after_synthesize, {"save": "save", "done": END})
    graph.add_edge("save", END)
    return graph.compile()

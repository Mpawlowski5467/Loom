"""Researcher agent as a LangGraph StateGraph.

Linear flow ``search → synthesize → save``. Each node wraps an existing
``Researcher`` method (logic is reused, not rewritten) and runs inside a
:func:`step` scope so its LLM calls are attributed to the step and the run's
shape is recorded for the Runs observability view.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.shuttle.graph_runtime import step

if TYPE_CHECKING:
    from langgraph.graph.state import CompiledStateGraph

    from agents.shuttle.researcher import Researcher


class ResearcherState(TypedDict, total=False):
    """Graph state threaded through the Researcher nodes."""

    question: str
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
        # ``research()`` sets ``_last_chain`` before building/invoking this
        # graph, so it is always populated here; assert to narrow it to the
        # non-optional ``ReadChainResult`` that ``_synthesize`` requires.
        chain = agent._last_chain
        assert chain is not None
        async with step("synthesize"):
            answer = await agent._synthesize(
                state["question"], state.get("vault_context", ""), chain
            )
        return {"answer": answer}

    async def save(state: ResearcherState) -> ResearcherState:
        async with step("save"):
            capture_id, capture_path = agent._save_capture(
                state["question"], state.get("answer", ""), state.get("refs", [])
            )
        return {"capture_id": capture_id, "capture_path": str(capture_path)}

    graph: StateGraph[ResearcherState] = StateGraph(ResearcherState)
    graph.add_node("search", search)
    graph.add_node("synthesize", synthesize)
    graph.add_node("save", save)
    graph.add_edge(START, "search")
    graph.add_edge("search", "synthesize")
    graph.add_edge("synthesize", "save")
    graph.add_edge("save", END)
    return graph.compile()

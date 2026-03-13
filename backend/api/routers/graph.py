"""Graph API route."""

from fastapi import APIRouter, Depends, Query

from core.graph import VaultGraph, build_graph, load_graph, save_graph
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
async def get_graph(
    note_type: str | None = Query(None, alias="type", description="Filter by note type"),
    tag: str | None = Query(None, description="Filter by tag"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> VaultGraph:
    """Return the vault knowledge graph, optionally filtered."""
    tdir = vm.active_threads_dir()
    loom_dir = vm.active_loom_dir()

    # Try cached graph first; rebuild if missing
    graph = load_graph(loom_dir)
    if graph is None:
        graph = build_graph(tdir)
        if tdir.exists():
            save_graph(graph, loom_dir)

    if note_type is None and tag is None:
        return graph

    # Filter nodes
    filtered_ids: set[str] = set()
    filtered_nodes = []
    for node in graph.nodes:
        if note_type is not None and node.type != note_type:
            continue
        if tag is not None and tag not in node.tags:
            continue
        filtered_nodes.append(node)
        filtered_ids.add(node.id)

    # Keep only edges where both endpoints survive the filter
    filtered_edges = [
        e for e in graph.edges if e.source in filtered_ids and e.target in filtered_ids
    ]

    return VaultGraph(nodes=filtered_nodes, edges=filtered_edges)

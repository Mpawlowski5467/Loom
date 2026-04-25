"""Graph builder: scan vault notes and produce nodes + edges for react-force-graph-2d."""

import json
from pathlib import Path

from pydantic import BaseModel, Field

from core.notes import parse_note


class GraphNode(BaseModel):
    """A single node in the knowledge graph."""

    id: str
    title: str
    type: str
    tags: list[str] = Field(default_factory=list)
    link_count: int = 0


class GraphEdge(BaseModel):
    """A directed edge between two notes."""

    source: str
    target: str


class VaultGraph(BaseModel):
    """Full graph payload for the frontend."""

    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


def build_graph(threads_dir: Path) -> VaultGraph:
    """Scan all .md files under threads/ and build a node/edge graph."""
    if not threads_dir.exists():
        return VaultGraph()

    md_files = [p for p in threads_dir.rglob("*.md") if ".archive" not in p.parts]

    # First pass: parse all notes, index by title (lowered) for wikilink resolution
    notes_by_title: dict[str, str] = {}  # lowercase title -> note id
    nodes: list[GraphNode] = []
    note_links: dict[str, list[str]] = {}  # note id -> list of wikilink targets (raw)

    for md_path in md_files:
        note = parse_note(md_path)
        if not note.id:
            continue

        nodes.append(
            GraphNode(
                id=note.id,
                title=note.title,
                type=note.type,
                tags=note.tags,
                link_count=len(note.wikilinks),
            )
        )
        notes_by_title[note.title.lower()] = note.id
        note_links[note.id] = note.wikilinks

    # Second pass: resolve wikilinks to note ids and build edges
    edges: list[GraphEdge] = []
    seen_edges: set[tuple[str, str]] = set()

    for source_id, links in note_links.items():
        for link_text in links:
            target_id = notes_by_title.get(link_text.lower())
            if target_id and target_id != source_id:
                pair = (source_id, target_id)
                if pair not in seen_edges:
                    seen_edges.add(pair)
                    edges.append(GraphEdge(source=source_id, target=target_id))

    return VaultGraph(nodes=nodes, edges=edges)


def save_graph(graph: VaultGraph, loom_dir: Path) -> Path:
    """Write graph.json to the .loom directory."""
    loom_dir.mkdir(parents=True, exist_ok=True)
    path = loom_dir / "graph.json"
    path.write_text(json.dumps(graph.model_dump(), indent=2))
    return path


def load_graph(loom_dir: Path) -> VaultGraph | None:
    """Load graph.json if it exists."""
    path = loom_dir / "graph.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return VaultGraph.model_validate(data)

"""Graph builder: scan vault notes and produce nodes + edges for react-force-graph-2d."""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, ValidationError

from core.notes import atomic_write_text, parse_note

logger = logging.getLogger(__name__)

# Bump when the graph.json on-disk format changes in a way that needs migration.
GRAPH_SCHEMA_VERSION = 1


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
    updated_at: str = ""
    # Stamped onto graph.json so the format can be migrated later. Defaults to
    # the current version so an older file that predates the field loads cleanly.
    schema_version: int = GRAPH_SCHEMA_VERSION


def build_graph(threads_dir: Path) -> VaultGraph:
    """Scan all .md files under threads/ and build a node/edge graph."""
    if not threads_dir.exists():
        return VaultGraph()

    md_files = [p for p in threads_dir.rglob("*.md") if ".archive" not in p.parts]

    # First pass: parse all notes; index by filename slug AND title so wikilinks
    # written either way ([[jordan-park]] or [[Jordan Park]]) resolve.
    notes_by_key: dict[str, str] = {}  # lowercase slug-or-title -> note id
    nodes: list[GraphNode] = []
    note_links: dict[str, list[str]] = {}  # note id -> list of wikilink targets (raw)

    for md_path in md_files:
        try:
            note = parse_note(md_path)
        except (OSError, ValueError, yaml.YAMLError, ValidationError):
            # One unreadable/malformed note must not take down the whole graph
            # (which would 500 /api/graph and kill the watcher's rebuild thread).
            # Skip it and keep building from the good notes.
            logger.warning("Skipping malformed note in graph build: %s", md_path, exc_info=True)
            continue
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
        slug = md_path.stem.lower()
        notes_by_key.setdefault(slug, note.id)
        if note.title:
            notes_by_key.setdefault(note.title.lower(), note.id)
        note_links[note.id] = note.wikilinks

    # Second pass: resolve wikilinks to note ids and build edges.
    # Strip [[alias|target]] and [[note#anchor]] decorations before lookup.
    edges: list[GraphEdge] = []
    seen_edges: set[tuple[str, str]] = set()

    for source_id, links in note_links.items():
        for link_text in links:
            target = link_text.split("|", 1)[0].split("#", 1)[0].strip().lower()
            target_id = notes_by_key.get(target)
            if target_id and target_id != source_id:
                pair = (source_id, target_id)
                if pair not in seen_edges:
                    seen_edges.add(pair)
                    edges.append(GraphEdge(source=source_id, target=target_id))

    return VaultGraph(nodes=nodes, edges=edges)


def save_graph(graph: VaultGraph, loom_dir: Path) -> Path:
    """Write graph.json to the .loom directory.

    Stamps ``graph.updated_at`` with the current UTC time so the API can
    serve ETag/Last-Modified headers based on it.
    """
    loom_dir.mkdir(parents=True, exist_ok=True)
    graph.updated_at = datetime.now(UTC).isoformat()
    path = loom_dir / "graph.json"
    # Atomic write: the watcher's timer thread and request threads can read/write
    # graph.json concurrently; a torn read would 500 load_graph. graph.json is
    # not itself a vault note, so don't re-flag the graph dirty (avoids recursion).
    atomic_write_text(path, json.dumps(graph.model_dump(), indent=2), mark_graph_dirty=False)
    return path


def load_graph(loom_dir: Path) -> VaultGraph | None:
    """Load graph.json if it exists.

    Returns ``None`` when the file is absent or a transient torn/corrupt read
    fails to parse, so callers degrade gracefully (rebuild) instead of 500ing.
    """
    path = loom_dir / "graph.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        logger.warning("graph.json unreadable or corrupt; rebuilding: %s", path, exc_info=True)
        return None
    # A file predating schema_version still validates (the model defaults it).
    return VaultGraph.model_validate(data)

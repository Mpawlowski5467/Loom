#!/usr/bin/env python3
"""Generate a demo vault with fictional notes for testing and demos."""

import sys
from pathlib import Path

# Allow running from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.notes import build_frontmatter, generate_id, now_iso
from core.vault import VaultManager

DEMO_VAULT = "demo"

NOTES: list[dict] = [
    # -- Projects --
    {
        "folder": "projects",
        "title": "Meridian Protocol",
        "type": "project",
        "tags": ["protocol", "distributed"],
        "body": (
            "## Overview\n\n"
            "Meridian is a distributed sync protocol for local-first applications. "
            "It uses CRDTs for conflict resolution and a gossip-based discovery layer.\n\n"
            "## Status\n\n"
            "Currently in design phase. See [[CRDT Fundamentals]] for background.\n\n"
            "## Team\n\n"
            "- [[Sable Whitmore]] — protocol design\n"
            "- [[Ren Castillo]] — implementation lead\n"
        ),
    },
    {
        "folder": "projects",
        "title": "Helix Dashboard",
        "type": "project",
        "tags": ["frontend", "dashboard", "react"],
        "body": (
            "## Overview\n\n"
            "Internal metrics dashboard built with React and D3. "
            "Tracks system health, user engagement, and pipeline throughput.\n\n"
            "## Links\n\n"
            "- Related: [[Observability Patterns]]\n"
            "- Lead: [[Ren Castillo]]\n"
        ),
    },
    {
        "folder": "projects",
        "title": "Nocturne Migration",
        "type": "project",
        "tags": ["migration", "database"],
        "body": (
            "## Goal\n\n"
            "Migrate legacy Nocturne database from PostgreSQL 12 to 16. "
            "Includes schema updates, data validation, and rollback strategy.\n\n"
            "## Notes\n\n"
            "See [[Database Indexing Strategies]] for optimization plan. "
            "[[Sable Whitmore]] owns the rollback runbook.\n"
        ),
    },
    # -- Topics --
    {
        "folder": "topics",
        "title": "CRDT Fundamentals",
        "type": "topic",
        "tags": ["distributed", "data-structures"],
        "body": (
            "## What are CRDTs?\n\n"
            "Conflict-free Replicated Data Types allow multiple replicas to be "
            "updated independently and converge to the same state.\n\n"
            "## Types\n\n"
            "- **G-Counter**: grow-only counter\n"
            "- **PN-Counter**: positive-negative counter\n"
            "- **LWW-Register**: last-writer-wins register\n"
            "- **OR-Set**: observed-remove set\n\n"
            "Used in [[Meridian Protocol]].\n"
        ),
    },
    {
        "folder": "topics",
        "title": "Observability Patterns",
        "type": "topic",
        "tags": ["monitoring", "devops"],
        "body": (
            "## Three Pillars\n\n"
            "1. **Logs** — structured event records\n"
            "2. **Metrics** — numeric time-series data\n"
            "3. **Traces** — distributed request flows\n\n"
            "## Application\n\n"
            "The [[Helix Dashboard]] uses these patterns for real-time monitoring. "
            "See also [[Event-Driven Architecture]].\n"
        ),
    },
    {
        "folder": "topics",
        "title": "Event-Driven Architecture",
        "type": "topic",
        "tags": ["architecture", "messaging"],
        "body": (
            "## Core Concepts\n\n"
            "Systems communicate through events rather than direct calls. "
            "Enables loose coupling and horizontal scaling.\n\n"
            "## Patterns\n\n"
            "- Event sourcing\n"
            "- CQRS (Command Query Responsibility Segregation)\n"
            "- Saga pattern for distributed transactions\n\n"
            "Related: [[Observability Patterns]], [[Meridian Protocol]]\n"
        ),
    },
    {
        "folder": "topics",
        "title": "Database Indexing Strategies",
        "type": "topic",
        "tags": ["database", "performance"],
        "body": (
            "## Index Types\n\n"
            "- **B-tree**: default, good for equality and range queries\n"
            "- **Hash**: fast equality lookups\n"
            "- **GIN**: full-text search and JSONB\n"
            "- **BRIN**: block range indexes for time-series\n\n"
            "## Notes\n\n"
            "Applied in [[Nocturne Migration]] for query optimization.\n"
        ),
    },
    {
        "folder": "topics",
        "title": "Graph Theory Basics",
        "type": "topic",
        "tags": ["math", "algorithms"],
        "body": (
            "## Definitions\n\n"
            "- **Node** (vertex): a point in the graph\n"
            "- **Edge**: a connection between two nodes\n"
            "- **Degree**: number of edges connected to a node\n\n"
            "## Algorithms\n\n"
            "- BFS / DFS traversal\n"
            "- Dijkstra's shortest path\n"
            "- Force-directed layout (used in knowledge graphs)\n\n"
            "See [[CRDT Fundamentals]] for related distributed concepts.\n"
        ),
    },
    {
        "folder": "topics",
        "title": "Markdown Best Practices",
        "type": "topic",
        "tags": ["writing", "documentation"],
        "body": (
            "## Structure\n\n"
            "- Use `##` headers for sections (embedding boundaries)\n"
            "- One concept per file (atomic notes)\n"
            "- Link liberally with `[[wikilinks]]`\n\n"
            "## Frontmatter\n\n"
            "Always include YAML frontmatter with id, title, type, and tags.\n"
        ),
    },
    # -- People --
    {
        "folder": "people",
        "title": "Sable Whitmore",
        "type": "person",
        "tags": ["engineering", "protocols"],
        "body": (
            "## Role\n\n"
            "Senior distributed systems engineer. Leads protocol design on "
            "[[Meridian Protocol]] and owns the rollback runbook for "
            "[[Nocturne Migration]].\n\n"
            "## Expertise\n\n"
            "- Distributed consensus algorithms\n"
            "- [[CRDT Fundamentals]]\n"
            "- Formal verification\n"
        ),
    },
    {
        "folder": "people",
        "title": "Ren Castillo",
        "type": "person",
        "tags": ["engineering", "frontend"],
        "body": (
            "## Role\n\n"
            "Full-stack engineer. Implementation lead on [[Meridian Protocol]] "
            "and primary developer for [[Helix Dashboard]].\n\n"
            "## Expertise\n\n"
            "- React / TypeScript\n"
            "- Systems programming (Rust)\n"
            "- [[Event-Driven Architecture]]\n"
        ),
    },
    {
        "folder": "people",
        "title": "Lark Okonkwo",
        "type": "person",
        "tags": ["design", "research"],
        "body": (
            "## Role\n\n"
            "UX researcher and information architect. Designs knowledge graph "
            "interfaces and studies note-taking workflows.\n\n"
            "## Projects\n\n"
            "- [[Graph Theory Basics]] research\n"
            "- [[Markdown Best Practices]] documentation\n"
        ),
    },
    # -- Daily --
    {
        "folder": "daily",
        "title": "2026-03-10",
        "type": "daily",
        "tags": ["standup"],
        "body": (
            "## Morning\n\n"
            "- Reviewed [[Meridian Protocol]] spec changes\n"
            "- Paired with [[Ren Castillo]] on gossip layer implementation\n\n"
            "## Afternoon\n\n"
            "- [[Helix Dashboard]] — fixed time range selector bug\n"
            "- Read up on [[Observability Patterns]] for alerting design\n"
        ),
    },
    {
        "folder": "daily",
        "title": "2026-03-11",
        "type": "daily",
        "tags": ["standup"],
        "body": (
            "## Morning\n\n"
            "- [[Nocturne Migration]] planning meeting with [[Sable Whitmore]]\n"
            "- Drafted rollback strategy\n\n"
            "## Afternoon\n\n"
            "- Deep dive into [[Database Indexing Strategies]]\n"
            "- Updated BRIN index plan for time-series tables\n"
        ),
    },
    {
        "folder": "daily",
        "title": "2026-03-12",
        "type": "daily",
        "tags": ["standup"],
        "body": (
            "## Morning\n\n"
            "- [[CRDT Fundamentals]] — wrote OR-Set implementation notes\n"
            "- Discussed conflict resolution with [[Sable Whitmore]]\n\n"
            "## Afternoon\n\n"
            "- [[Helix Dashboard]] PR review\n"
            "- Caught up with [[Lark Okonkwo]] on graph UI research\n"
        ),
    },
    # -- Captures --
    {
        "folder": "captures",
        "title": "Research Paper - Automerge Design",
        "type": "capture",
        "tags": ["paper", "crdt"],
        "source": "manual",
        "body": (
            "Automerge paper notes: JSON-like CRDT that supports nested objects "
            "and lists. Could be relevant for [[Meridian Protocol]].\n\n"
            "Key insight: operation-based approach allows undo/redo.\n"
        ),
    },
    {
        "folder": "captures",
        "title": "Meeting Notes - Q2 Planning",
        "type": "capture",
        "tags": ["meeting", "planning"],
        "source": "manual",
        "body": (
            "Q2 priorities discussed:\n"
            "1. Ship [[Meridian Protocol]] alpha\n"
            "2. Complete [[Nocturne Migration]]\n"
            "3. [[Helix Dashboard]] v2 with [[Observability Patterns]] integration\n"
        ),
    },
]


def seed_demo() -> None:
    """Create a demo vault with fictional notes."""
    vm = VaultManager()

    if not vm.vault_exists(DEMO_VAULT):
        vm.init_vault(DEMO_VAULT)
        print(f"Created vault: {DEMO_VAULT}")
    else:
        print(f"Vault '{DEMO_VAULT}' already exists")

    vm.set_active_vault(DEMO_VAULT)
    threads = vm.active_threads_dir()

    created = 0
    for note_data in NOTES:
        folder = note_data["folder"]
        title = note_data["title"]
        filename = title.lower().replace(" ", "-").replace("/", "-") + ".md"
        filepath = threads / folder / filename

        if filepath.exists():
            continue

        note_id = generate_id()
        ts = now_iso()
        meta = {
            "id": note_id,
            "title": title,
            "type": note_data["type"],
            "tags": note_data["tags"],
            "created": ts,
            "modified": ts,
            "author": "user",
            "source": note_data.get("source", "manual"),
            "links": [],
            "status": "active",
            "history": [
                {
                    "action": "created",
                    "by": "user",
                    "at": ts,
                    "reason": "Demo vault seed",
                }
            ],
        }

        content = build_frontmatter(meta) + "\n" + note_data["body"]
        filepath.write_text(content, encoding="utf-8")
        created += 1
        print(f"  + {folder}/{filename}")

    print(f"\nSeeded {created} notes into '{DEMO_VAULT}' vault")

    # Rebuild graph
    from core.graph import build_graph, save_graph

    graph = build_graph(threads)
    save_graph(graph, vm.active_loom_dir())
    print(f"Graph rebuilt: {len(graph.nodes)} nodes, {len(graph.edges)} edges")


if __name__ == "__main__":
    seed_demo()

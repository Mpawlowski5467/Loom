---
id: thr_7a8b9c
title: Graph Databases
type: topic
tags: [graph-theory, databases, knowledge-graph]
created: 2026-03-03T11:00:00Z
modified: 2026-03-13T10:20:00Z
author: user
source: manual
links:
  - loom-knowledge-graph
  - local-first-software
  - research-vector-embeddings
status: active
history:
  - action: created
    by: user
    at: 2026-03-03T11:00:00Z
    reason: "Research notes on graph databases for the Loom project"
  - action: edited
    by: agent:weaver
    at: 2026-03-08T09:00:00Z
    reason: "Expanded key concepts section with property graph model details"
  - action: linked
    by: agent:spider
    at: 2026-03-13T10:20:00Z
    reason: "Connected to vector embeddings research capture"
---

# Graph Databases

## Definition

Graph databases are storage systems designed to treat relationships between data as first-class citizens. Unlike relational databases that use joins to traverse connections, graph databases store relationships directly, making traversal operations constant-time regardless of dataset size.

## Key Concepts

- **Property Graph Model**: Nodes and edges both carry key-value properties. This is the model used by Neo4j, and it maps well to how [[loom-knowledge-graph]] represents notes and their wikilink connections.
- **Adjacency-free indexing**: Each node directly references its neighbors, so traversal does not require index lookups. This is what makes graph queries fast at depth.
- **Graph traversal languages**: Cypher (Neo4j), Gremlin (Apache TinkerPop), SPARQL (RDF). For Loom, we use a simpler custom traversal since the graph is stored as JSON.
- **Hybrid approaches**: Combining graph structure with [[research-vector-embeddings]] enables semantic search that respects topological proximity. Notes that are close in meaning AND close in the graph should rank highest.

## Connections

This topic is foundational to the [[loom-knowledge-graph]] project. The vault's `graph.json` is essentially a lightweight property graph where nodes are notes and edges are wikilinks. Understanding graph theory helps with layout algorithms, community detection, and link prediction.

The [[local-first-software]] movement intersects here because most graph databases (Neo4j, Dgraph) are server-based. For Loom, we needed something embeddable. LanceDB handles the vector side; the graph structure is a plain JSON file that Sigma.js renders directly.

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Full graph DB (Neo4j) | Rich query language, mature tooling | Server dependency, overkill for personal vault |
| JSON adjacency list | Simple, portable, local-first | No query language, manual traversal |
| SQLite + graph extension | Good balance, embeddable | Less mature graph extensions |

## References

- [Neo4j Graph Database](https://neo4j.com/)
- [Property Graph Model specification](https://github.com/opencypher/openCypher)
- Robinson, Webber & Eifrem — *Graph Databases* (O'Reilly)

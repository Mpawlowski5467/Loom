---
id: thr_a1b2c3
title: Loom Knowledge Graph
type: project
tags: [knowledge-graph, ai, local-first, sigma-js]
created: 2026-03-02T10:30:00Z
modified: 2026-03-14T16:45:00Z
author: user
source: manual
links:
  - graph-databases
  - local-first-software
  - prompt-engineering
  - alice-chen
  - bob-kumar
status: active
history:
  - action: created
    by: user
    at: 2026-03-02T10:30:00Z
    reason: "Initial project note for the Loom knowledge graph system"
  - action: edited
    by: user
    at: 2026-03-08T14:20:00Z
    reason: "Added architecture decisions section after evaluating vector DBs"
  - action: linked
    by: agent:spider
    at: 2026-03-10T09:15:00Z
    reason: "Connected to graph-databases and local-first-software topics"
  - action: edited
    by: user
    at: 2026-03-14T16:45:00Z
    reason: "Updated status after standup discussion with Bob"
---

# Loom Knowledge Graph

A local-first AI memory system that uses a multi-agent backbone and a visual knowledge graph to organize personal knowledge.

## Goals

- Build a markdown-based vault that feels like a second brain
- Use [[graph-databases]] principles to surface connections between notes
- Keep everything [[local-first-software]] so data never leaves the user's machine
- Leverage [[prompt-engineering]] to make agent interactions feel natural and useful

## Architecture Decisions

- **Vector DB**: Chose LanceDB for local embedding storage. Zero network dependency, fast hybrid search, and it stores vectors alongside metadata in a single file.
- **Graph UI**: Sigma.js with force-directed layout. Nodes are notes, edges are wikilinks. The graph should breathe and feel alive.
- **Editor**: Plate (Slate.js) for WYSIWYG markdown editing with wikilink autocomplete.
- **Agent framework**: Two-tier architecture. Loom agents manage the vault, Shuttle agents produce content. Clean separation of concerns.

## Team

- [[alice-chen]] — Leading the frontend graph visualization work. Her experience with D3.js and network analysis is invaluable.
- [[bob-kumar]] — Handling the agent architecture and prompt compiler. Deep background in LLM orchestration.

## Current Status

Sprint 3 in progress. Core vault operations are solid. Graph visualization is rendering with breathing animations. Next priority is the prompt compiler pipeline and agent memory management.

## Open Questions

- How aggressively should Spider auto-link? Need to define thresholds in the linking policy.
- Should we support multiple embedding models simultaneously for A/B testing?
- What is the right summarization cadence for agent memory.md files?

## References

- [Sigma.js documentation](https://www.sigmajs.org/)
- [LanceDB docs](https://lancedb.github.io/lancedb/)
- [Zettelkasten method](https://zettelkasten.de/posts/overview/)

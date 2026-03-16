---
id: thr_5b6c7d
title: "Research: Vector Embeddings Landscape 2026"
type: capture
tags: [research, embeddings, vector-db, ai]
created: 2026-03-12T15:30:00Z
modified: 2026-03-12T15:30:00Z
author: user
source: manual
links:
  - loom-knowledge-graph
  - graph-databases
  - prompt-engineering
status: active
history:
  - action: created
    by: user
    at: 2026-03-12T15:30:00Z
    reason: "Research dump on current state of vector embeddings for Loom"
---

# Research: Vector Embeddings Landscape 2026

Raw research notes on vector embedding models and their suitability for the [[loom-knowledge-graph]] project.

## Embedding Models Compared

### OpenAI text-embedding-3-small
- 1536 dimensions, very good quality-to-cost ratio
- Matryoshka representations — can truncate to 512 or 256 dims with minimal quality loss
- Downside: requires API call, not local-first
- Currently our default in Loom

### OpenAI text-embedding-3-large
- 3072 dimensions, marginal improvement over small for our use case
- 6x the cost, not worth it for personal vault search

### Nomic Embed v2
- Open-source, runs locally via Ollama
- 768 dimensions, competitive with OpenAI small on MTEB benchmarks
- Supports both short (query) and long (document) embedding with task prefixes
- Best option for a fully local-first setup

### Cohere Embed v4
- 1024 dimensions, excellent multilingual support
- Interesting compression options (int8, binary) for large-scale deployments
- Overkill for personal vault but worth noting

### Jina Embeddings v3
- 1024 dimensions with adjustable via Matryoshka
- Task-specific LoRA adapters (retrieval, classification, separation)
- Can run locally with moderate GPU

## Key Decisions for Loom

1. **Default**: Keep text-embedding-3-small as the default for users who have an OpenAI key. Quality is excellent and cost is negligible for personal vault sizes (hundreds to low thousands of notes).

2. **Local option**: Offer Nomic Embed v2 via Ollama as the local-first alternative. Users who want zero cloud dependency can use this with acceptable quality trade-off.

3. **Hybrid search**: Embeddings alone are not enough. Combine with keyword matching (BM25-style) and [[graph-databases]] topology for ranking. Notes that are semantically similar AND close in the wikilink graph should rank highest.

4. **Chunking strategy**: Chunk by `##` headers. Each section gets its own embedding. This aligns with how [[prompt-engineering]] context pruning works — we can pull in specific sections rather than entire notes.

## Open Questions

- Should we re-embed when switching models, or maintain parallel indices?
- What is the right dimensionality trade-off for Matryoshka truncation?
- How often should we re-embed notes that have been edited?

## Sources

- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
- [Nomic Embed technical report](https://arxiv.org/abs/2402.01613)
- [LanceDB vector search docs](https://lancedb.github.io/lancedb/search/)

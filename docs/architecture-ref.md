# Loom — Architecture Reference

Condensed reference for Claude Code. Full doc: see `ARCHITECTURE.md` in project root.

## Vault Structure

```
~/.loom/
├── config.yaml                # global: active vault, provider keys
├── vaults/<name>/
│   ├── vault.yaml             # vault config, custom folder defs
│   ├── threads/
│   │   ├── daily/             # daily logs (YYYY-MM-DD.md)
│   │   ├── projects/          # project notes
│   │   ├── topics/            # cross-project knowledge
│   │   ├── people/            # collaborator context
│   │   ├── captures/          # raw inbox (agents process from here)
│   │   ├── .archive/          # archived "deleted" notes
│   │   └── <custom>/          # user folders
│   ├── agents/
│   │   ├── weaver/            # config.yaml, memory.md, state.json, logs/
│   │   ├── spider/
│   │   ├── archivist/
│   │   ├── scribe/
│   │   ├── sentinel/
│   │   ├── researcher/        # also has chat/
│   │   ├── standup/           # also has chat/
│   │   └── _council/chat/     # Loom Council chat history
│   ├── rules/
│   │   ├── prime.md           # constitution (user-owned, immutable to agents)
│   │   └── schemas/           # note templates per type
│   ├── prompts/
│   │   └── shared/            # system preamble
│   └── .loom/
│       ├── index.db           # LanceDB vectors
│       ├── graph.json         # node/edge map for UI
│       ├── history.log        # audit trail
│       └── changelog/<agent>/<date>.md
```

## Note Format

```yaml
---
id: thr_<6char>
title: Note Title
type: topic|project|person|daily|capture|custom
tags: [tag1, tag2]
created: ISO8601
modified: ISO8601
author: user|agent:<name>
source: capture:<id>|manual|bridge:<type>
links: []
status: active|archived
history:
  - action: created|edited|linked|archived
    by: user|agent:<name>
    at: ISO8601
    reason: "description"
---
```

## Agent Tiers

**Loom Layer (system)**: Weaver (create), Spider (link), Archivist (organize), Scribe (summarize), Sentinel (validate). Manage the vault. User talks to them collectively via Loom Council Chat (transparent multi-agent thread).

**Shuttle Layer (task)**: Researcher (query + synthesize), Standup (daily recap). Produce content into captures/. User talks to them individually. 1:1 chat with history.

**Boundary**: Shuttle agents write to `captures/` only. Loom agents process from there.

## Read-Before-Write Chain

```
1. vault.yaml
2. rules/prime.md
3. agents/<self>/memory.md
4. _index.md of target folder
5. related [[linked]] notes
6. THEN: act
```

Hard block on failure (default). Soft warning for trusted agents (configurable).

## Index

- LanceDB local vectors
- Smart chunking by `##` headers
- Hybrid search: semantic + keyword/tag + graph-aware boosting
- Tags + title embedded; other frontmatter = filters only
- Real-time watcher for small edits, batch for heavy ops

## UI Layout

```
┌─────────────────────────────────────────────────┐
│ LOOM    [Graph] [Board] [Inbox]    🔍 Search  ⚙  │
├────────┬──────────────────┬─────────────────────┤
│ FILE   │ MAIN AREA        │ RIGHT SIDEBAR       │
│ TREE   │ (graph/board/    │ (slides in:         │
│ always │  inbox)          │  thread view or     │
│ visible│                  │  rich editor)       │
├────────┴──────────────────┴─────────────────────┤
│ Status bar                                      │
└─────────────────────────────────────────────────┘
```

- Fixed width panels, not resizable
- File tree: VS Code style, filter bar, drag-to-move, colored dots per type
- Graph: Sigma.js, force-directed, drag/zoom/pan/hover-highlight/pin/filter
- Nodes: dots + labels, size by connections, color by type, glow on hover
- Edges: thickness by density, muted ink
- Editor: custom markdown renderer ([`frontend/src/editor/renderMarkdown.tsx`](../frontend/src/editor/renderMarkdown.tsx)) with `[[wikilink]]` support and inline marks
- Create note: modal → Weaver processes via read chain
- Toasts: bottom-right for agent actions
- Auto-refresh: 5-10s interval
- Bidirectional sync: graph ↔ file tree

## Color System

Default = **paper** theme. `tokens.css` also ships navy, forest, and sepia variants — same token names, different palettes.

| Token (paper) | Hex |
|---------------|-----|
| `--bg-base` | `#f5f1e8` |
| `--bg-surface` | `#ede8da` |
| `--bg-elevated` | `#e3dcca` |
| `--ink` | `#1a1815` |
| `--ink-2` | `#5c5851` |
| `--ink-3` | `#8c877d` |
| `--you` (user) | `#a83a2c` (brick red) |
| `--agent` | `#2d4a7c` (ink blue) |
| `--node-project` | `#2d4a7c` (ink blue) |
| `--node-topic` | `#4a6b3a` (moss) |
| `--node-person` | `#6b3a6b` (aubergine) |
| `--node-daily` | `#8c877d` (graphite) |
| `--node-capture` | `#a8722a` (ochre) |
| `--node-custom` | `#2d6b6b` (teal ink) |

Fonts: Fraunces (prose/headings), Inter (UI chrome), JetBrains Mono (timestamps/tags).

## Providers Config

```yaml
providers:
  default: openai
  openai:
    api_key: ${OPENAI_API_KEY}
    embed_model: text-embedding-3-small
    chat_model: gpt-4o
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    chat_model: claude-sonnet-4-20250514
  ollama:
    host: http://localhost:11434
    embed_model: nomic-embed-text
    chat_model: llama3
```

Embed and chat models are independent. Mix and match.

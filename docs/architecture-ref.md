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

**Custom agents**: a registry (`/api/agents/registry`) + a Board "Add agent" modal let users define their own Shuttle-tier agents (persisted to `agents.yaml`); the 7 built-ins stay read-only. Running a custom agent dispatches through `AgentRunner` to `agents.shuttle.custom.CustomAgent`, which gathers vault context, calls the chat provider with the agent's system prompt, and writes a capture for triage.

## Orchestration

Multi-step agent work runs as **LangGraph `StateGraph`s**, not imperative call chains:

- **Capture pipeline** (`agents/loom/pipeline_graph.py`): `weaver → spider → scribe → sentinel → enforce`. Conditional edges short-circuit to `END` on an empty capture and loop back to Weaver once on a `failed` Sentinel verdict (regenerate → re-validate, then enforce regardless). `AgentRunner.run_pipeline` drives it; `POST /api/captures/process` calls that.
- **Shuttle graphs** (`agents/shuttle/researcher_graph.py`, `standup_graph.py`): Researcher = `search → synthesize → save`; Standup = `collect → (conditional) → generate/skip → save`.

Graph nodes wrap the existing agent methods (so the read-before-write chain, changelog, and memory still fire) and call Loom's own provider layer — LangGraph is the orchestrator only; **no LangChain model objects**, so the dependency stays small. The shared run/step recorder + enforcement live in `agents/shuttle/graph_runtime.py` and `agents/loom/enforcement.py`.

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
- Keyword-only fallback when no embedding provider is configured
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
- Live refresh: the UI holds an SSE stream (`GET /api/events/stream`) and re-fetches notes/captures (one debounced reload per burst) when the file watcher emits a `vault-changed` event, so agent/external edits reach an open UI without a manual reload. The Board additionally polls agent activity on a short, tab/visibility-gated interval.
- Bidirectional sync: graph ↔ file tree
- Graph display panel: labels/size/spacing/edge-thickness/breathing/travelers, persisted to localStorage
- Board: two modes — cards (agent grid) and pulse (live activity)
- Settings: appearance, providers (key validation), vault, about/diagnostics, danger zone

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
  xai:
    api_key: ${XAI_API_KEY}
    chat_model: grok-3
  openrouter:
    api_key: ${OPENROUTER_API_KEY}
    chat_model: qwen/qwen3-next-80b-a3b-instruct:free
  ollama:
    host: http://localhost:11434
    embed_model: nomic-embed-text
    chat_model: llama3
```

Embed and chat models are independent. Mix and match.

## Tracing

Every provider is wrapped in a `TracedProvider` that records each call (provider, model, messages, response, duration, caller). Stored in a 500-entry in-memory ring + mirrored to disk at `.loom/traces/<date>/`. Read via `/api/traces` (recent) and `/api/traces/disk` (by date). The UI's "raw call" link opens the exact exchange.

**Run/step grouping**: each trace also carries the `run` and `step` it was made under (set by the LangGraph run scope via `contextvars`, the same mechanism as `caller`). A graph run also writes a run summary to `.loom/traces/<date>/run-<id>.json` capturing its ordered steps — including steps that made no LLM call (e.g. Spider's deterministic linking, `enforce`). This reifies a multi-step run's *shape* instead of a flat call list. Read via `/api/traces/runs` (recent runs) and `/api/traces/runs/{id}` (one run's step timeline + each step's traces); the Board "Runs" view (`RunFeed`) renders it.

## Council Streaming

`POST /api/chat/send/stream` (Server-Sent Events). Fans out to all 5 Loom agents, capped at 3 concurrent. Emits one `contributions` event (per-agent takes), streams the aggregator reply as `token` events, ends with `done` (+ `trace_id`). The non-streaming `POST /api/chat/send` also exists for Shuttle 1:1 chat.

## Graph Layout & Motion

- Modes: **constellation** (ForceAtlas2 force-directed) and **orbit** (focus-first concentric rings; rings/spiral/arms scenes)
- Edge travelers: dashes animate along edges on an SVG overlay; pace adjustable or off
- Breathing: gentle node-size oscillation
- All display knobs live in the graph display panel (persisted to localStorage, with a reset button)

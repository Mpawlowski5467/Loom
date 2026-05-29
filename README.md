<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg" />
    <img src="docs/assets/logo.svg" alt="Loom" width="320" />
  </picture>
</p>

<p align="center">
  A local-first AI memory system with a multi-agent backbone and a visual knowledge graph.
</p>

![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![React](https://img.shields.io/badge/react-19-61dafb)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-in%20development-orange)

---

## What is Loom?

Loom is a personal knowledge system that stores everything as **plain Markdown** on your disk and uses a **team of AI agents** to keep it organized. Notes connect via `[[wikilinks]]`, and a **force-directed graph** lets you see your mind at a glance.

You write captures; agents do the structuring, linking, summarizing, and validating. The whole stack runs locally — your files, your provider keys, your machine.

## Why Loom?

- **Local-first.** Notes live as readable Markdown in `~/.loom/vaults/`. No lock-in, no cloud sync, no proprietary database.
- **Multi-agent, not single-prompt.** Seven specialized agents in two tiers (Loom Layer manages the vault; Shuttle Layer produces content) — plus any custom agents you add — collaborate via a shared *read-before-write* discipline.
- **Visual by default.** A `Sigma.js` + `graphology` canvas shows your notes as a living network — drag, zoom, filter by type or tag.
- **Provider-agnostic.** Plug in OpenAI, Anthropic, xAI, OpenRouter, or a local Ollama model. Chat and embedding providers are independent, and every model call is recorded as an inspectable trace.

## Architecture at a glance

```mermaid
flowchart LR
    User((User))

    subgraph Frontend["Frontend — React + Vite"]
        Graph[Graph View]
        Board[Board View]
        Inbox[Inbox View]
        Editor[Markdown Editor]
    end

    subgraph Backend["Backend — FastAPI"]
        API[REST API]
        Runner[Agent Runner]
        Watcher[File Watcher]
    end

    subgraph Storage["Local Storage"]
        Vault[(Markdown Vault)]
        Index[(LanceDB Vectors)]
        Cache[(Graph Cache)]
        Traces[(LLM Traces)]
    end

    subgraph Providers["AI Providers"]
        OpenAI
        Anthropic
        xAI
        OpenRouter
        Ollama
    end

    User <--> Frontend
    Frontend <--> API
    API --> Runner
    API --> Watcher
    Runner --> Providers
    Runner --> Vault
    Runner --> Index
    Runner --> Traces
    Watcher --> Vault
    API --> Cache
```

The backend reads and writes the vault on disk; the frontend renders it. The agent runner orchestrates AI calls; the file watcher keeps the index fresh when notes change outside the UI.

## The two-tier agent system

```mermaid
flowchart TB
    User((User))
    Council[Loom Council Chat]
    Direct[1:1 Shuttle Chat]

    subgraph LoomLayer["Loom Layer — system agents"]
        Weaver
        Spider
        Archivist
        Scribe
        Sentinel
    end

    subgraph ShuttleLayer["Shuttle Layer — task agents"]
        Researcher
        Standup
        Custom[Custom agents]
    end

    Captures[(captures/)]
    Vault[(Vault: daily, projects, topics, people, ...)]

    User --> Council
    User --> Direct
    Council --> LoomLayer
    Direct --> ShuttleLayer
    ShuttleLayer -- writes to --> Captures
    LoomLayer -- processes --> Captures
    LoomLayer -- maintains --> Vault
```

**Loom Layer** agents manage the vault. You speak to them collectively via the **Loom Council** — a transparent multi-agent thread where each one chimes in by role.

**Shuttle Layer** agents are task-driven; you chat with them one-on-one. They never write into the main vault — they drop output into `captures/`, and the Loom Layer takes it from there. You can also define your own custom Shuttle-tier agents from the Board; the seven built-ins below stay read-only.

### Agent reference

| Agent | Tier | Role |
|---|---|---|
| **Weaver** | Loom | Converts raw captures into structured notes with YAML frontmatter. |
| **Spider** | Loom | Finds semantic connections and maintains bidirectional `[[wikilinks]]`. |
| **Archivist** | Loom | Audits the vault — flags stale notes, broken links, missing metadata. |
| **Scribe** | Loom | Writes folder `_index.md` files and daily logs. |
| **Sentinel** | Loom | Validates every agent action against `prime.md` rules and schemas. |
| **Researcher** | Shuttle | Answers questions by searching the vault and citing source notes. |
| **Standup** | Shuttle | Generates a daily activity recap from changelogs and modified notes. |

## Read-before-write

Every agent follows the same chain before performing any mutation. This keeps the vault internally consistent and gives `prime.md` (your constitution) real authority.

```mermaid
flowchart LR
    Trigger[Action triggered] --> R1[vault.yaml]
    R1 --> R2[rules/prime.md]
    R2 --> R3[agents/&lt;self&gt;/memory.md]
    R3 --> R4[target _index.md]
    R4 --> R5[related linked notes]
    R5 --> Check{Sentinel<br/>validates}
    Check -- pass --> Act[Write/edit/link]
    Check -- fail --> Block[Hard block or warn]
```

Hard block on failure by default; trusted agents can be configured for soft-warn.

## How it works

### From capture to note

A raw capture never becomes a note in one step. Weaver classifies and formats it, Sentinel validates the result against `prime.md` and the matching schema, the note is written to disk, and Spider connects it to the rest of the vault. The inbox lets you `preview` this whole chain as a dry run before you `commit`.

```mermaid
sequenceDiagram
    actor User
    participant Inbox as Captures inbox
    participant Weaver
    participant Sentinel
    participant Vault as Markdown vault
    participant Spider

    User->>Inbox: Drop a raw capture
    Inbox->>Weaver: Process (or dry-run preview)
    Weaver->>Weaver: Classify type, tags, folder
    Weaver->>Sentinel: Validate vs prime.md + schema
    Sentinel-->>Weaver: Pass / flag
    Weaver->>Vault: Write structured note
    Vault->>Spider: New note to connect
    Spider->>Vault: Add [[wikilinks]] to related notes
    Spider-->>User: Filed and linked
```

### Council chat, streamed

When you ask the Loom Council a question, the backend fans the prompt out to all five system agents (capped at three concurrent calls so a single turn doesn't blow a free model's rate limit). Each agent's take arrives as one `contributions` event, then an aggregator distils them into a single voice that streams back token by token over Server-Sent Events. The final `done` frame carries a `trace_id` so you can open the raw model call.

```mermaid
sequenceDiagram
    actor User
    participant API as POST /api/chat/send/stream
    participant Council as Loom Council
    participant Agents as 5 Loom agents
    participant LLM as Chat provider

    User->>API: Ask the Council
    API->>Council: Open SSE stream
    Council->>Agents: Fan out (≤3 concurrent)
    Agents->>LLM: One call per agent
    LLM-->>Agents: Per-agent answer
    Agents-->>Council: Contributions
    Council-->>User: event: contributions
    Council->>LLM: Aggregate into one voice
    LLM-->>Council: Token stream
    Council-->>User: event: token (repeated)
    Council-->>User: event: done (+ trace_id)
```

### Providers, and every call traced

All five providers sit behind one registry. Chat and embedding providers are resolved independently, and every provider is wrapped in a `TracedProvider` that records each exchange — provider, model, messages, response, duration — into a 500-entry in-memory ring that also mirrors to disk by date. The "raw call" link anywhere in the UI reads straight from `/api/traces`.

```mermaid
flowchart LR
    Agent[Agent / Council]
    Registry["Provider registry<br/>get_chat_provider()"]
    Traced[TracedProvider wrapper]

    subgraph Providers["Chat + embed providers"]
        OpenAI
        Anthropic
        xAI
        OpenRouter
        Ollama
    end

    subgraph Store["Trace store"]
        Ring[(In-memory ring · 500)]
        Disk[(Disk mirror · by date)]
    end

    UI["Raw-call inspector<br/>GET /api/traces"]

    Agent --> Registry
    Registry --> Traced
    Traced --> Providers
    Providers -- response --> Traced
    Traced -- record --> Ring
    Ring --> Disk
    Store --> UI
```

### Hybrid search

Search blends three signals: semantic similarity from LanceDB vectors, plain keyword matching with tag/type filters, and a graph-aware boost that lifts notes already linked to strong hits. When no embedding provider is configured, it degrades gracefully to keyword-only.

```mermaid
flowchart LR
    Q[Search query]

    subgraph Signals["Three signals"]
        V["Semantic<br/>LanceDB vectors"]
        K["Keyword<br/>+ tag / type filters"]
        G["Graph-aware boost<br/>linked notes rank higher"]
    end

    M["Merge & rank"]
    R[Results]

    Q --> V
    Q --> K
    V --> M
    K --> M
    G -.boosts.-> M
    M --> R
```

## Features

### Knowledge graph
- Force-directed Sigma.js 3 + graphology layout with drag, zoom, pan
- Orbit mode: focus-first concentric rings around a selected node (rings / spiral / arms scenes)
- Edge travelers: little dashes animate along edges so the graph reads as alive, not static
- Display panel: tune label size & density, node size, spacing, edge thickness, breathing, and travelers — persisted to `localStorage` with one-click reset
- Hover highlights neighbors; edge thickness scales with link density
- Filter by note type or tag; click-to-select syncs with the file tree
- ETags + `Last-Modified` for cheap refresh

### Vault & notes
- Multi-vault filesystem at `~/.loom/vaults/`
- Fixed core folders (`daily`, `projects`, `topics`, `people`, `captures`) plus your own
- Atomic Markdown writes with YAML frontmatter (`id`, `title`, `type`, `tags`, `created`, `modified`, `author`, `status`, `history`)
- Edit history tracked per-mutation in frontmatter
- Deletion = move to `.archive/`, never destroyed
- File watcher reflects external edits live

### Search
- Hybrid: semantic (LanceDB vectors) + keyword + tag/type filters
- Graph-aware boosting — linked notes rank higher
- Keyword fallback when no embedding provider is configured
- Global search bar (Cmd/Ctrl+K) plus a separate file-tree filter

### Agents & chat
- Loom Council chat streams its answer token-by-token over SSE, with each agent's contribution shown as its own bubble
- Every model call is captured as a trace — open the "raw call" on any message to see provider, model, prompt, response, and latency
- Custom agents: spin up your own Shuttle-tier agent from the Board; the seven built-in agents stay read-only
- Per-agent `memory.md` summarized every 20 actions
- Per-agent-per-day changelog at `.loom/changelog/<agent>/<date>.md`
- Chat history persisted as Markdown: `agents/_council/chat/` for Council, `agents/<name>/chat/` for Shuttle
- Captures inbox view for triaging raw input before Weaver structures it

### Providers
- OpenAI (chat + embed)
- Anthropic (chat)
- xAI / Grok (chat)
- OpenRouter (chat — including `:free` models, with rate-limit-aware retries)
- Ollama (local chat + embed)
- Chat and embedding providers configured independently

### Onboarding wizard
- First-run multi-step flow: Welcome → Vault Setup → Theme Picker → Provider Config
- Live theme previews (Paper, Navy, Forest, Sepia) before commit
- Inline "Test connection" against the picked provider — failures don't block save
- Skip-friendly: provider step is optional, defaults pick safe models
- Onboarding state lives in `~/.loom/config.yaml` under `onboarding.completed`

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Python 3.11+, FastAPI, Pydantic v2, Uvicorn |
| Frontend | React 19, TypeScript 5.9, Vite |
| Graph | Sigma.js 3 + graphology (force-atlas2 layout) |
| Editor | Custom Markdown renderer (`frontend/src/editor/renderMarkdown.tsx`) with `[[wikilink]]` support |
| Vector DB | LanceDB + PyArrow |
| AI | OpenAI / Anthropic SDKs, `httpx` for xAI / OpenRouter / Ollama |
| Realtime | Server-Sent Events (SSE) for streamed Council replies |
| File sync | `watchdog` |
| Rate limit | `slowapi` |
| Tests | `pytest` + `pytest-asyncio` (backend), `vitest` + Testing Library (frontend) |
| Lint/format | `ruff` (Python), ESLint + Prettier (TS) |

## Quick start

### Prerequisites
- Python ≥ 3.11
- Node.js ≥ 18 with npm
- An API key for at least one provider (or a running Ollama instance)

### Backend
```bash
cd backend
pip install -e ".[dev]" --break-system-packages
uvicorn api.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev   # serves on http://localhost:5173
```

On first run the **onboarding wizard** walks you through vault name, theme, and provider setup. The provider step is optional and can be added later from the in-app **Settings → Providers** panel (or by editing `~/.loom/config.yaml` directly). The backend reads `~/.loom/config.yaml` for global config and scaffolds a vault at `~/.loom/vaults/<name>` when the wizard completes.

### Seed an example vault
```bash
# Copy the demo vault to your local Loom directory
cp -r examples/demo-vault ~/.loom/vaults/demo
```

Then switch to it via `PUT /api/vaults/active` with `{"name": "demo"}` (or re-run the onboarding wizard with `demo` as the vault name).

## Configuration

Global config lives at `~/.loom/config.yaml`:

```yaml
active_vault: default
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

Per-vault config lives at `~/.loom/vaults/<name>/vault.yaml` (custom folders, agent overrides, etc).

## Project structure

```
Loom/
├── backend/
│   ├── api/              # FastAPI routers (notes, graph, search, chat, ...)
│   ├── agents/
│   │   ├── loom/         # Weaver, Spider, Archivist, Scribe, Sentinel
│   │   └── shuttle/      # Researcher, Standup
│   ├── core/             # vault, notes, config, watcher, providers, traces, exceptions
│   ├── index/            # LanceDB indexer, searcher, chunker
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── views/        # Graph, Thread, Inbox, Board, Settings, Splash, Palette
│   │   ├── components/   # AppShell, MainShell, layout/, primitives/, graph/
│   │   ├── onboarding/   # First-run wizard: Welcome, VaultSetup, ThemePicker, ProviderConfig
│   │   ├── theme/        # applyTheme, readCssVar, theme metadata
│   │   ├── context/      # AppContext + useLoomConfig (config + onboarding state)
│   │   ├── api/          # client.ts, chat.ts (SSE), traces.ts, agentsRegistry.ts, config.ts, …
│   │   ├── graph/        # sigma setup, layouts, travelers, breathing, drag handlers
│   │   ├── editor/       # markdown render + plain editing
│   │   └── styles/       # tokens.css, base.css, views/*
│   └── public/
├── docs/                 # architecture-ref.md, style-guide.md
├── examples/
│   └── demo-vault/       # ready-to-use sample vault
├── scripts/              # seed and utility scripts
└── .github/workflows/    # CI
```

## API surface

The backend exposes a REST API on `:8000`. The most-used endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/graph` | Fetch the force-directed graph (supports ETag caching) |
| `GET` | `/api/tree` | File tree |
| `GET` `POST` `PUT` `DELETE` | `/api/notes` | Note CRUD (delete = archive) |
| `GET` | `/api/search?q=...` | Hybrid search |
| `GET` `POST` | `/api/captures` | List & process captures (single or batch) |
| `GET` | `/api/agents` | Agent status + action counts |
| `GET` | `/api/agents/activity` | Live per-agent activity (polled by the Pulse view) |
| `GET` `POST` `PATCH` `DELETE` | `/api/agents/registry` | List / create / edit / remove custom agents |
| `GET` | `/api/agents/{name}/changelog` | Agent changelog |
| `POST` | `/api/chat/send` | Talk to a Shuttle agent or the Council |
| `POST` | `/api/chat/send/stream` | Streamed Council reply (Server-Sent Events) |
| `GET` `POST` `PUT` | `/api/vaults` | Multi-vault management |
| `GET` `POST` | `/api/settings/providers` | Provider config (keys masked on read) |
| `GET` `PATCH` | `/api/config` | Global config (theme, active vault, default provider — redacted) |
| `GET` `POST` | `/api/onboarding/status` / `/complete` | First-run wizard gate |
| `POST` | `/api/providers/{name}/test` | Test provider credentials without saving |
| `GET` | `/api/traces` | Recent LLM traces (`/api/traces/disk` pages older ones by date) |
| `GET` | `/api/health` / `/api/ready` | Health + readiness probes |

## Development

```bash
# Backend
ruff check backend/
ruff format backend/
pytest backend/tests/

# Frontend
cd frontend
npm run lint
npm run format
npm run test
```

CI runs on push via `.github/workflows/ci.yml`.

## Status

In active development. What works today:

- All 5 Loom Layer agents (Weaver, Spider, Archivist, Scribe, Sentinel)
- Both Shuttle Layer agents (Researcher, Standup) plus user-defined custom agents
- Graph, Board, Inbox, and Thread views
- First-run onboarding wizard (vault, theme, provider)
- Settings UI — appearance, providers (with key validation), vault, about/diagnostics, danger zone
- Streaming Loom Council chat with per-call trace inspection
- Multi-vault management
- Hybrid semantic + keyword search with graph-aware boosting
- Provider system (OpenAI, Anthropic, xAI, OpenRouter, Ollama)
- File watcher, rate limiting, health/readiness probes

In flight:
- Scribe's daily-log generation (index works; daily summary being tuned)
- Sentinel's full AI-assisted validation (LLM path exists with a static fallback)
- Standup calendar integration
- Custom-agent execution (registry + Board UI exist; run-wiring pending)

Known gaps:
- Thin frontend test coverage — backend has thorough pytest coverage; the frontend has 7 test files (onboarding, primitives, context, markdown), with views + graph largely untested

See [`docs/architecture-ref.md`](docs/architecture-ref.md) for the full design and [`docs/style-guide.md`](docs/style-guide.md) for conventions.

## Wireframes

Early sketches of the visual language and view models. These are *wireframes, not the final UI* — the real product renders in ink-blue + brick-red duotone on warm cream paper, with serif typography from the design language.

<p align="center">
  <img src="docs/wireframes/wireframe.png" alt="Visual vocabulary — color split, node types, views overview" width="720" />
</p>

### Views

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/wireframes/graphview.png" alt="Graph view — constellation map" width="100%" /><br />
      <sub><b>Graph</b> — constellation map with type-colored nodes, hub sizing, hover-highlighted neighborhoods</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/wireframes/orbitview.png" alt="Orbit view — focus-first concentric rings" width="100%" /><br />
      <sub><b>Orbit</b> — focus-first concentric rings around a selected note</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/wireframes/threadview.png" alt="Thread view — markdown reader with edit history and backlinks" width="100%" /><br />
      <sub><b>Thread</b> — serif-led note reader with edit history, backlinks, and local graph</sub>
    </td>
    <td align="center">
      <img src="docs/wireframes/editorview.png" alt="Editor view — split source and rendered preview" width="100%" /><br />
      <sub><b>Editor</b> — split source/preview writing experience with wikilink autocomplete</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/wireframes/inboxview.png" alt="Inbox view — captures with Weaver suggestions" width="100%" /><br />
      <sub><b>Inbox</b> — capture-to-note flow with Weaver suggestions for type, folder, tags, and links</sub>
    </td>
    <td align="center">
      <img src="docs/wireframes/boardview.png" alt="Board view — agent cards and activity log" width="100%" /><br />
      <sub><b>Board</b> — agent presence: cards and pulse modes with a live changelog</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/wireframes/councilview.png" alt="Council view — transparent multi-agent chat" width="100%" /><br />
      <sub><b>Council</b> — transparent multi-agent thread where all five Loom Layer agents answer together</sub>
    </td>
    <td align="center">
      <img src="docs/wireframes/pulseview.png" alt="Pulse view — live ECG-style agent vitals" width="100%" /><br />
      <sub><b>Pulse</b> — live ECG-style heartbeats showing each agent's running / queued / idle state</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/wireframes/searchview.png" alt="Search palette — hybrid semantic + keyword find" width="60%" /><br />
      <sub><b>Search</b> — Cmd/Ctrl-K palette with hybrid semantic + keyword scoring across the vault</sub>
    </td>
  </tr>
</table>

## License

MIT — see [LICENSE](LICENSE) (when added).

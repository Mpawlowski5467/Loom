# Loom

A local-first AI memory system with a multi-agent backbone and a visual knowledge graph. Markdown-based vault, provider-agnostic AI, two-tier agent architecture, React + Sigma.js graph UI.

## Stack

- **Backend**: Python 3.11+ / FastAPI
- **Agent orchestration**: LangGraph (`StateGraph`) — the capture pipeline and Shuttle agents run as graphs; nodes call Loom's own provider layer, so no LangChain provider stack is pulled in.
- **Frontend**: React + TypeScript / Sigma.js (graph) / hand-rolled markdown renderer
- **Vector DB**: LanceDB
- **Storage**: Markdown files with YAML frontmatter
- **AI**: Provider-agnostic (OpenAI, Anthropic, xAI, OpenRouter, Ollama); every call traced
- **Theme**: Paper theme — warm cream paper aesthetic, single duotone accent. The final set is Paper, Porcelain, Herbarium, Midnight Ink, Lagoon, and Ember.
- **Packaging**: Docker (multi-stage build → single container serving UI + API on one port); `docker compose up`. Vaults persist in the `loom-data` named volume.

## Repo Layout

```
loom/
├── backend/                  # Python — FastAPI server, agents, index
│   ├── api/                  # FastAPI routes
│   ├── agents/loom/          # Weaver, Spider, Archivist, Scribe, Sentinel
│   ├── agents/shuttle/       # Researcher, Standup
│   ├── core/                 # Vault management, file watcher, config
│   ├── index/                # LanceDB, embeddings, search
│   ├── scripts/              # Maintenance scripts
│   ├── tests/                # pytest
│   └── pyproject.toml        # Python package + tooling config
├── frontend/
│   └── src/
│       ├── api/              # HTTP clients (config, vaults, providers, …)
│       ├── components/       # Layout, primitives, shared components
│       ├── context/          # AppContext, useLoomConfig
│       ├── data/             # Seed / sample data for dev
│       ├── editor/           # Custom markdown renderer (wikilinks, inline marks)
│       ├── graph/            # Sigma.js setup, layout, interactions
│       ├── onboarding/       # First-run wizard
│       ├── styles/           # tokens.css + view stylesheets
│       ├── theme/            # Theme tokens + runtime swap
│       └── views/            # GraphView, BoardView, ThreadView, InboxView
├── docs/                     # Architecture docs, reference, wireframes/
├── examples/                 # Example vaults, rules, schemas
└── scripts/                  # Repo-level scripts
```

## Key Concepts

- **Vault**: multi-vault markdown filesystem at `~/.loom/vaults/`. Fixed core folders (daily, projects, topics, people, captures) + user custom folders.
- **Wikilinks**: all inter-note links use `[[note-name]]` syntax.
- **Two-tier agents**: Loom Layer (system: Weaver, Spider, Archivist, Scribe, Sentinel) manages the vault. Shuttle Layer (task: Researcher, Standup) produces content into `captures/`, Loom agents process it.
- **Read-Before-Write**: every agent must read vault.yaml → prime.md → memory.md → _index.md → related notes BEFORE writing anything.
- **prime.md**: user-owned constitution. Immutable to agents by default.

## Commands

```bash
# Docker (one command — serves UI + API on one port)
docker compose up        # builds + runs → open http://localhost:8000
                         # vaults persist in the `loom-data` named volume

# Backend
cd backend && pip install -e ".[dev]" --break-system-packages
uvicorn api.main:app --reload --port 8000

# Frontend
cd frontend && npm install
npm run dev          # dev server on localhost:5173

# Lint / format
ruff check backend/
ruff format backend/
cd frontend && npm run lint
```

## Architecture Reference

Full architecture doc: @docs/architecture-ref.md
Style guide: @docs/style-guide.md

## Implementation Status

**Implemented**
- All 5 Loom Layer agents (Weaver, Spider, Archivist, Scribe, Sentinel) with `execute_with_chain()` + read-before-write
- Both Shuttle Layer agents (Researcher, Standup)
- LangGraph orchestration: the capture pipeline (`agents/loom/pipeline_graph.py` — Weaver→Spider→Scribe→Sentinel→enforce, with a one-shot Sentinel-retry loop back to Weaver on a `failed` verdict) and the Shuttle agents (`agents/shuttle/researcher_graph.py`, `standup_graph.py`) run as `StateGraph`s. `AgentRunner.run_pipeline` drives the pipeline graph; `/api/captures/process` calls it. Graph nodes wrap the existing agent methods (read-before-write preserved) and call Loom's own providers — no LangChain models. `agents/shuttle/graph_runtime.py` holds the shared run/step bridge.
- Custom agents: registry (`/api/agents/registry`) + Board "Add agent" modal (Shuttle-tier) with execution — running a custom agent dispatches to `agents.shuttle.custom.CustomAgent`, which writes a capture for triage. Customs are runnable and editable from their Board card (keyed by registry id); the builder modal has an icon picker, prompt starter templates, and an optional per-agent provider/model override
- Unified capture ingress (`core/capture_ingress.py`) for HTTP, Shuttle agents, and Bridge sources, with external-ID idempotency and immediate durable-job policy
- Durable Inbox processing: per-vault SQLite jobs with retry/backoff/cancel/review, Active/Review/History UI, retention controls, and typed SSE refresh domains
- Scheduled Standup workspace with timezone-aware durable scheduling and an encrypted, read-only iCalendar Bridge that can enrich recaps and create event captures
- 4 views: GraphView (Sigma.js — force layout plus five orbit scenes (rings/spiral/arms/galaxy/wave) with fluid drag physics, faux-3D depth layering, edge travelers, display panel), ThreadView (markdown reader), InboxView (capture triage), BoardView (agent cards + pulse viz toggle; clicking a card opens a detail modal with the agent's instructions, its recent runs, and its LLM calls)
- File tree renders only on Graph and Board and can be hidden (nav toggle or ⌘B, persisted at `loom.treeVisible`); Thread/Inbox/Settings are full-width
- Create-note modal: segmented type chips with node-color dots, nested-folder picker, tag chip editor (own stylesheet `styles/views/note-modal.css`)
- Onboarding wizard — 4 steps: Welcome → VaultSetup → ThemePicker → ProviderConfig (Finish gated on a validated provider)
- Settings UI: Appearance, Providers (with key validation), Hardware & Models (hardware scan → local-model good/okay/heavy ratings + opt-in Ollama benchmark, per-agent model pickers), Vault, About (diagnostics + re-run onboarding), Danger Zone
- Model management backend: `GET /api/hardware` (+`/save`, `/recommendations`, `/benchmark`), live model listing per provider (`GET /api/providers/{name}/models`, Ollama `/api/tags` + OpenAI-compatible discovery), per-agent chat overrides (`/api/settings/agent-models` → `GlobalConfig.agent_models`; registry caches per `(provider, chat_model)` and agents rebind on save)
- Backend: hybrid search (vector + keyword + graph boosting), file watcher (watchdog), rate limiting (slowapi), health/ready probes
- Per-agent `memory.md` summarization (every 20 actions), per-agent-per-day changelog
- Provider system: OpenAI, Anthropic, xAI, OpenRouter, Ollama — chat + embed independently configurable
- Streaming Loom Council chat (SSE fan-out, ≤3 concurrent) + LLM trace system (in-mem ring + disk mirror, "raw call" inspector via `/api/traces`). Traces carry a `run`/`step` tag so multi-step graph runs surface as connected runs (`/api/traces/runs`, `/api/traces/runs/{id}`); per-agent runs/calls render inside the Board agent-detail modal (`RunFeed` with an agent filter)
- Optional infra (both off by default; app is byte-identical without them): Redis LLM/embed response cache (`LOOM_REDIS_URL` — registry wraps providers as `TracedProvider(CachedProvider(instance))`, chat_stream bypasses, failures degrade to misses) and Postgres trace mirror (`LOOM_DATABASE_URL` — bounded-queue async writes to `loom_traces`/`loom_runs`; traces router prefers pg for history paging, runs listing, and backfill, falls back to disk). A daily lifespan sweep (`core/trace_retention.py`) prunes disk + pg traces past `LOOM_TRACE_RETENTION_DAYS` (default 30, negative disables). Health gains always-ready informational `cache`/`database` components
- Multi-vault management via `/api/vaults`
- Scribe daily-log generation; Sentinel AI-assisted validation (LLM path with a deterministic fallback, deterministic rules otherwise)
- Cmd+K palette, file tree with filter bar, toasts
- Optional `LOOM_API_TOKEN` shared-token gate on `/api/*` (`Authorization: Bearer` or `X-Loom-Token`, constant-time; off by default, so health/ready and the localhost posture are unchanged)
- Strict `mypy` gates CI (type backlog at zero, Python 3.12 target); router-level end-to-end API test (capture → process → graph → search) with stubbed providers
- CI in `.github/workflows/`, LICENSE present

**Known gaps (deliberate v1 boundaries)**
- Provider API keys are Fernet-encrypted at rest in `config.yaml` (`enc:v1:` prefix, machine-local master key in `~/.loom/.secret.key`) — defense-in-depth against casual config disclosure, not a substitute for auth; no OS-keychain integration yet
- No auth layer on the API by design (safe on localhost; do not expose the port as-is). The optional `LOOM_API_TOKEN` gate is a speed bump, not real auth. `TrustedHostMiddleware` (localhost hosts, override via `LOOM_ALLOWED_HOSTS`) blocks DNS-rebinding
- Deferred by design (planned, not built — see `docs/VISION.md`): the remaining Bridge adapters (Google/Outlook OAuth, GitHub, Email — the read-only iCalendar Bridge and scheduled Standups ship), the Prompt Compiler, and multi-file attachments
- AppContext still hosts most global state; `useLoomConfig`, `useAgentPolling`, and `useHealthPolling` are split out so far
- Frontend test coverage is broad (views, graph logic, API clients, settings, board cards/pulse all covered); the `useGraph*` graph hooks remain the main untested area

## Conventions

- All notes use YAML frontmatter with `id`, `title`, `type`, `tags`, `created`, `modified`, `author`, `status`, `history` fields.
- Edit history tracked in frontmatter: every mutation logged with `action`, `by`, `at`, `reason`.
- Deletion = archive. Files move to `threads/.archive/`, never truly deleted.
- Agent actions always logged in per-agent-per-day changelog at `.loom/changelog/<agent>/<date>.md`.
- Agents have `memory.md` summarized every 20 actions.
- Chat history saved as markdown: `agents/_council/chat/` for Loom Council, `agents/<name>/chat/` for Shuttle agents.
- Global search bar in top nav + file tree filter bar (separate).
- Graph: Sigma.js 3.x. One `layout` option (persisted in `loom.graphDisplay`): force (FA2 + overlap relaxation, default) or five focus-first scenes (rings/spiral/arms/galaxy/wave) — picker in the display panel, auto-cycle opt-in for the scene layouts. Dragging runs a live multi-hop spring/repulsion sim on the shared frame loop (`graph/fluidSim.ts`): sticky drops in force layout (new homes persist), elastic spring-back in scene layouts. Type filters are compact dot toggles with a clear affordance. Faux-3D depth: deterministic per-node z drives size/ink fade/draw order (toggleable). Nodes = dots with labels, edges thicken on hover.
- **Color split**: brick red (`#a83a2c`, `--you`) = user actions, ink blue (`#2d4a7c`, `--agent`) = agent actions. No third accent color.
- **Paper surfaces**: `--bg-base #f5f1e8`, `--bg-surface #ede8da`, `--bg-elevated #e3dcca`.
- **Ink**: `--ink #1a1815`, `--ink-2 #5c5851`, `--ink-3 #8c877d`. Hairlines `rgba(26,24,21,0.08 / 0.18)`.
- **Node swatches**: project ink-blue, topic moss `#4a6b3a`, people aubergine `#6b3a6b`, daily graphite `#8c877d`, capture ochre `#a8722a`, custom teal-ink `#2d6b6b`.
- **Fonts**: Fraunces (serif, prose & headings), Inter (sans, UI chrome), JetBrains Mono (timestamps, tags, labels).
- **Default ease**: `cubic-bezier(.2, .7, .3, 1)` for any transition longer than 100ms.

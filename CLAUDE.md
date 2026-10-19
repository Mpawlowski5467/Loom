# Loom

A local-first AI memory system with a multi-agent backbone and a visual knowledge graph. Markdown-based vault, provider-agnostic AI, two-tier agent architecture, React + shadcn/ui + Sigma.js UI.

## Stack

- **Backend**: Python 3.11+ / FastAPI
- **Agent orchestration**: LangGraph (`StateGraph`) — the capture pipeline and Shuttle agents run as graphs; nodes call Loom's own provider layer, so no LangChain provider stack is pulled in.
- **Frontend**: React 19 + TypeScript / shadcn/ui (Radix + Tailwind v4) / React Router / Sigma.js + graphology (graph) / Plate note editor (lossless markdown bridge) + react-markdown previews / lucide-react icons / Sonner toasts
- **Vector DB**: LanceDB
- **Storage**: Markdown files with YAML frontmatter
- **AI**: Provider-agnostic (OpenAI, Anthropic, xAI, OpenRouter, Ollama); every call traced
- **Theme**: six themes as CSS variables on `<html data-theme>` — Graphite (dark, default), Paper (light), Midnight, Forest, Linen (warm light), High contrast — plus accent override, colorblind graph palette and editor font. Tokens live only in `frontend/src/styles/themes.css`.
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
│       ├── api/              # HTTP clients (config, vaults, providers, …); mocks/ for missing endpoints
│       ├── app/              # Routes (routes.ts URL model, AppRoutes)
│       ├── components/       # ui/ (shadcn primitives), shell/ (header, layout), theme/, shared components
│       ├── context/          # AppContext, useLoomConfig, useRouteNavigation
│       ├── data/             # Seed / sample data for dev
│       ├── editor/           # plate/ (note editor, lossless markdown bridge), markdown/ (block splitter, wikilink remark plugin), react-markdown previews
│       ├── graph/            # Sigma.js setup, layout, interactions
│       ├── onboarding/       # First-run wizard
│       ├── lib/              # cn() and small shared helpers
│       ├── styles/           # themes.css (all tokens) + legacy view stylesheets (being retired)
│       ├── theme/            # ThemeProvider, registry, appearance persistence, useThemeColors
│       └── views/            # GraphView, notes/ (NotesView), BoardView, InboxView, ThreadsView, SettingsView
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
VITE_LOOM_MOCKS=1 npm run dev   # also serve not-yet-built endpoints from fictional mocks (docs/ui-backend-gaps.md)
NODE_OPTIONS=--no-experimental-webstorage npm run test:run   # unit tests (flag needed on Node ≥ 25)

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
- LangGraph orchestration: the capture pipeline (`agents/loom/pipeline_graph.py` — Weaver→Sentinel→Spider→Scribe→enforce, with a one-shot Sentinel-retry loop back to Weaver on a `failed` verdict; Spider/Scribe run only on a `passed`/`warning` verdict) and the Shuttle agents (`agents/shuttle/researcher_graph.py`, `standup_graph.py`) run as `StateGraph`s. `AgentRunner.run_pipeline` drives the pipeline graph; `/api/captures/process` calls it. Graph nodes wrap the existing agent methods (read-before-write preserved) and call Loom's own providers — no LangChain models. `agents/shuttle/graph_runtime.py` holds the shared run/step bridge.
- Custom agents: registry (`/api/agents/registry`) + Board "Add agent" modal (Shuttle-tier) with execution — running a custom agent dispatches to `agents.shuttle.custom.CustomAgent`, which writes a capture for triage. Customs are runnable and editable from their Board card (keyed by registry id); the builder modal has an icon picker, prompt starter templates, and an optional per-agent provider/model override
- Unified capture ingress (`core/capture_ingress.py`) for HTTP, Shuttle agents, and Bridge sources, with external-ID idempotency and immediate durable-job policy
- Durable Inbox processing: per-vault SQLite jobs with retry/backoff/cancel/review, Active/Review/History UI, retention controls, and typed SSE refresh domains
- Scheduled Standup workspace with timezone-aware durable scheduling and an encrypted, read-only iCalendar Bridge that can enrich recaps and create event captures
- App shell (React Router): header with Graph · Notes · Board · Inbox · Threads tabs, search trigger, agent status, dark/light quick toggle, settings, New note; routes `/graph`, `/notes/<folder>/<slug>`, `/board`, `/inbox`, `/threads/:id?`, `/settings/:section?` (old `?view=` URLs redirect); ⌘K palette, `g g/n/b/i/t` view chords, ⌘N, ⌘⇧C, ⌘B, ⌘;
- Views: GraphView at `/graph` (shadcn: vault sidebar with folder counts and a communities legend, both filters | Sigma.js canvas on a dot grid with brand selection ring and brand-highlighted edges, zoom/fit controls, a creation-date timeline with play | the selected note open beside the graph in a 520px panel — compact Plate editor, Archivist warning card, last commits with Undo, "Open full editor"; toolbar breadcrumb plus Communities / Superseded / Local only toggles and a Display popover with the five orbit scenes (rings/spiral/arms/galaxy/wave), fluid drag physics, faux-3D depth and edge travelers), NotesView at `/notes/<folder>/<slug>` (shadcn: vault tree with superseded markers, new note/folder, drag-to-move, rename and archive | Plate editor with supersession banner, properties block, Spider suggestion cards, slash menu, `[[` picker, raw-markdown mode, version-checked save and conflict compare | context rail with a Sigma local graph, related notes and agent activity; History sheet with git undo), InboxView (shadcn: a 380px list with inline quick capture, All / Needs review / Filed tabs, search, bulk Skip/Queue, and rows with a source badge, relative time, status (Proposal ready / New / Queued / Processing / Needs review / Failed / Filed) and a preview line | the selected capture: source line, title, raw content in a mono blockquote, job state cards, and Weaver's proposal — file path, type, tags, community, Spider's links, close-match merge, Sentinel pre-check (estimated client-side until gap 11) — with Approve and file / Edit first / Discard; Jobs tab with the durable ledger; auto-process policy in a header popover; j/k/e/↵ keys), BoardView (shadcn: title, stat cards — actions today, Sentinel pass rate, open flags, next scheduled run, derived client-side (`views/board/boardStats.ts`) — Loom agent cards with initials avatars, Running/Idle/Scheduled/Watching, last action, weekly count, Logs + Run now, one dashed card for the Shuttle agents (Researcher/Standup workspaces, custom agents, Add agent), Cards/Pulse toggle, an activity table where each row is a git commit with a Sentinel badge and Undo | a 380px Council column with agent messages, a Summary card and a composer; Logs opens the agent's instructions, runs and LLM calls), ThreadsView (placeholder). The shadcn rebuild is phased (`feat/ui-*`); views not yet rebuilt keep their legacy stylesheets in a `legacy` cascade layer with old variable names aliased to the new tokens (`styles/legacy-tokens.css`)
- ⌘B (persisted at `loom.treeVisible`) hides the Graph sidebar; Notes has its own vault tree; Board, Inbox and Settings are full-width
- Create-note modal: segmented type chips with node-color dots, nested-folder picker, tag chip editor (own stylesheet `styles/views/note-modal.css`)
- Onboarding wizard — 4 steps: Welcome → VaultSetup → ThemePicker (shared ThemeGrid) → ProviderConfig (Finish gated on a validated provider)
- Settings UI (`/settings/:section`): General (diagnostics + re-run onboarding), Appearance (shadcn: theme cards with live previews, follow system with per-mode themes, accent swatches, editor font, graph palette, text size/density/motion), Agents (per-agent model pickers), Models & providers (providers with key validation, hardware scan → local-model ratings + opt-in Ollama benchmark), Privacy (automation policy), Integrations (connections), Vault (vaults, archived notes, danger zone)
- Appearance: `ThemeProvider` paints `data-*` attributes on `<html>`, caches in localStorage (`loom.appearance.v2`, old keys migrated) and syncs per vault via `/api/settings/appearance` when the backend has it (it doesn't yet — see `docs/ui-backend-gaps.md`); an inline script in `index.html` paints before the bundle loads (no theme flash; `boot.test.ts` keeps it in sync); `contrast.test.ts` enforces WCAG AA for every theme and accent
- Model management backend: `GET /api/hardware` (+`/save`, `/recommendations`, `/benchmark`), live model listing per provider (`GET /api/providers/{name}/models`, Ollama `/api/tags` + OpenAI-compatible discovery), per-agent chat overrides (`/api/settings/agent-models` → `GlobalConfig.agent_models`; registry caches per `(provider, chat_model)` and agents rebind on save)
- Backend: hybrid search (vector + keyword + graph boosting), file watcher (watchdog), rate limiting (slowapi), health/ready probes
- Per-agent `memory.md` summarization (every 20 actions), per-agent-per-day changelog
- Provider system: OpenAI, Anthropic, xAI, OpenRouter, Ollama — chat + embed independently configurable
- Streaming Loom Council chat (SSE fan-out, ≤3 concurrent) + LLM trace system (in-mem ring + disk mirror, "raw call" inspector via `/api/traces`). Traces carry a `run`/`step` tag so multi-step graph runs surface as connected runs (`/api/traces/runs`, `/api/traces/runs/{id}`); per-agent runs/calls render inside the Board agent-detail modal (`RunFeed` with an agent filter)
- Optional infra (both off by default; app is byte-identical without them): Redis LLM/embed response cache (`LOOM_REDIS_URL` — registry wraps providers as `TracedProvider(CachedProvider(instance))`, chat_stream bypasses, failures degrade to misses) and Postgres trace mirror (`LOOM_DATABASE_URL` — bounded-queue async writes to `loom_traces`/`loom_runs`; traces router prefers pg for history paging, runs listing, and backfill, falls back to disk). A daily lifespan sweep (`core/trace_retention.py`) prunes disk + pg traces past `LOOM_TRACE_RETENTION_DAYS` (default 30, negative disables). Health gains always-ready informational `cache`/`database` components
- Multi-vault management via `/api/vaults`
- Git-backed vault history (`core/history/`): every vault write is a commit (`<agent>: <action> <path>` + Agent/Action/Reason/Sentinel trailers; runs grouped into one commit; human edits committed after a quiet period); `/api/history` list/diff/revert where undo is a Sentinel-validated `git revert`-style commit, never a rewrite. Thread view *Change history* + Board activity Undo. Configured by `history:` in vault.yaml; the SQLite revision journal stays the crash-safe write path
- Scribe daily-log generation; Sentinel AI-assisted validation (LLM path with a deterministic fallback, deterministic rules otherwise)
- ⌘K palette (`components/palette/`, cmdk): hybrid search with a "hybrid · <ms>" readout, filter chips (All / Notes / Actions / Agents / each community), grouped results (notes with highlighted matches, actions — capture ⇧↵, Ask Council, Run Spider behind a confirm — and agents, which open on Board via `/board?agent=<id>`), a preview with "Why it matched" (estimated in the browser until the API reports it) and Open / Show in graph (⌥↵), superseded hidden by default (⌥S); falls back to title/tag matching offline. Sonner toasts
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
- Graph: Sigma.js 3.x. One `layout` option (persisted in `loom.graphDisplay`): force (FA2 + overlap relaxation, default) or five focus-first scenes (rings/spiral/arms/galaxy/wave) — picker in the display panel, auto-cycle opt-in for the scene layouts. Dragging runs a live multi-hop spring/repulsion sim on the shared frame loop (`graph/fluidSim.ts`): sticky drops in force layout (new homes persist), elastic spring-back in scene layouts. Structural changes (notes/links added or removed) are diffed onto the live graph and Sigma instance (`graph/graphSync.ts`): new nodes are seeded at their neighbors' centroid (or a ring outside the layout) and settled locally, with no Sigma rebuild, main-thread FA2 or camera reset; a large batch in force layout then gets a bounded FA2 web-worker settle with survivors pinned (`graph/batchSettle.ts`). Nodes are colored by community: Louvain over the link graph, computed client-side and seeded (`graph/communities.ts`); the four largest communities get `--community-1..4`, the rest a neutral tone, each named after its most-linked note. One `GraphNodeFilter` (`graph/nodeFilter.ts`: folder, community, show superseded, timeline cutoff) drives visibility; the timeline cutoff is never persisted. "Local only" isolates the selection's direct neighbors. Translucent colors are premultiplied before they reach Sigma (`graph/glColor.ts`), whose WebGL blending expects it. Faux-3D depth: deterministic per-node z drives size/ink fade/draw order (toggleable). Nodes = dots with labels; the hovered or selected node's edges thicken and turn `--brand`.
- **Colors**: every color is a token from `frontend/src/styles/themes.css` (shadcn names where they overlap: `--background`, `--foreground`, `--muted`, `--accent` = hover surface, `--border`, `--primary` = high-contrast buttons; Loom's own: `--brand` accent, `--chip`, `--nav-active`, `--banner`, `--ok`, `--warning`, `--danger-foreground`, `--community-1..4`). Use them as Tailwind utilities (`bg-brand`, `text-muted-foreground`). No hex in components (eslint enforces it); Tailwind's default palette is disabled. A new token must be added to every theme block and pass `contrast.test.ts`.
- **Graph colors**: Sigma can't read CSS variables; read them through `useThemeColors()` (hex values) and repaint when its `key` changes.
- **Fonts** (bundled via Fontsource): Geist (UI), Geist Mono (paths, hashes, keyboard hints, timestamps), Newsreader (optional serif editor font). Editor text uses `font-editor`.
- **Default ease**: `cubic-bezier(.2, .7, .3, 1)` for any transition longer than 100ms.

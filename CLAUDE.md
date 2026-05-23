# Loom

A local-first AI memory system with a multi-agent backbone and a visual knowledge graph. Markdown-based vault, provider-agnostic AI, two-tier agent architecture, React + Sigma.js graph UI.

## Stack

- **Backend**: Python 3.11+ / FastAPI
- **Frontend**: React + TypeScript / Sigma.js (graph) / hand-rolled markdown renderer
- **Vector DB**: LanceDB
- **Storage**: Markdown files with YAML frontmatter
- **AI**: Provider-agnostic (OpenAI, Anthropic, xAI, Ollama)
- **Theme**: Paper theme — warm cream paper aesthetic, single duotone accent. Paper is the default; navy/forest/sepia variants also ship in tokens.css.

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
│   └── tests/                # pytest
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
├── docs/                     # Architecture docs, reference
├── examples/                 # Example vaults, rules, schemas
├── scripts/                  # Repo-level scripts
├── wireframes/               # Reference UI mockups
└── pyproject.toml
```

## Key Concepts

- **Vault**: multi-vault markdown filesystem at `~/.loom/vaults/`. Fixed core folders (daily, projects, topics, people, captures) + user custom folders.
- **Wikilinks**: all inter-note links use `[[note-name]]` syntax.
- **Two-tier agents**: Loom Layer (system: Weaver, Spider, Archivist, Scribe, Sentinel) manages the vault. Shuttle Layer (task: Researcher, Standup) produces content into `captures/`, Loom agents process it.
- **Read-Before-Write**: every agent must read vault.yaml → prime.md → memory.md → _index.md → related notes BEFORE writing anything.
- **prime.md**: user-owned constitution. Immutable to agents by default.

## Commands

```bash
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
Task prompts: @docs/tasks/

## Implementation Status

**Implemented**
- All 5 Loom Layer agents (Weaver, Spider, Archivist, Scribe, Sentinel) with `execute_with_chain()` + read-before-write
- Both Shuttle Layer agents (Researcher, Standup)
- 4 views: GraphView (Sigma.js), ThreadView (markdown reader), InboxView (capture triage), BoardView (agent cards/round-table/pulse)
- Onboarding wizard — 4 steps: Welcome → VaultSetup → ThemePicker → ProviderConfig
- Backend: hybrid search (vector + keyword + graph boosting), file watcher (watchdog), rate limiting (slowapi), health/ready probes
- Per-agent `memory.md` summarization (every 20 actions), per-agent-per-day changelog
- Provider system: OpenAI, Anthropic, xAI, Ollama — chat + embed independently configurable
- Multi-vault management via `/api/vaults`
- Cmd+K palette, file tree with filter bar, toasts
- CI in `.github/workflows/`, LICENSE present

**In flight**
- Scribe daily-log generation (index works; summary tuning)
- Sentinel full AI-assisted validation (LLM path exists with static fallback)
- Standup calendar integration (generate() works; no calendar link)
- Settings UI (post-onboarding theme/provider/vault management) — not yet started

**Known gaps**
- Zero frontend tests (backend has 30 test files; frontend has none)
- No `.env.example` (README implies one exists)

## Conventions

- All notes use YAML frontmatter with `id`, `title`, `type`, `tags`, `created`, `modified`, `author`, `status`, `history` fields.
- Edit history tracked in frontmatter: every mutation logged with `action`, `by`, `at`, `reason`.
- Deletion = archive. Files move to `threads/.archive/`, never truly deleted.
- Agent actions always logged in per-agent-per-day changelog at `.loom/changelog/<agent>/<date>.md`.
- Agents have `memory.md` summarized every 20 actions.
- Chat history saved as markdown: `agents/_council/chat/` for Loom Council, `agents/<name>/chat/` for Shuttle agents.
- Global search bar in top nav + file tree filter bar (separate).
- Graph: Sigma.js 3.x, force-directed by default with an orbit (focus-first concentric) mode. Nodes = dots with labels, edges thicken on hover.
- **Color split**: brick red (`#a83a2c`, `--you`) = user actions, ink blue (`#2d4a7c`, `--agent`) = agent actions. No third accent color.
- **Paper surfaces**: `--bg-base #f5f1e8`, `--bg-surface #ede8da`, `--bg-elevated #e3dcca`.
- **Ink**: `--ink #1a1815`, `--ink-2 #5c5851`, `--ink-3 #8c877d`. Hairlines `rgba(26,24,21,0.08 / 0.18)`.
- **Node swatches**: project ink-blue, topic moss `#4a6b3a`, people aubergine `#6b3a6b`, daily graphite `#8c877d`, capture ochre `#a8722a`, custom teal-ink `#2d6b6b`.
- **Fonts**: Fraunces (serif, prose & headings), Inter (sans, UI chrome), JetBrains Mono (timestamps, tags, labels).
- **Default ease**: `cubic-bezier(.2, .7, .3, 1)` for any transition longer than 100ms.

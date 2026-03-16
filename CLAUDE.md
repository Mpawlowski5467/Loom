# Loom

A local-first AI memory system with a multi-agent backbone and a visual knowledge graph. Markdown-based vault, provider-agnostic AI, two-tier agent architecture, React + react-force-graph-2d graph UI.

## Stack

- **Backend**: Python 3.11+ / FastAPI
- **Frontend**: React / react-force-graph-2d / Markdown textarea + react-markdown
- **Vector DB**: LanceDB
- **Storage**: Markdown files with YAML frontmatter
- **AI**: Provider-agnostic (OpenAI, Anthropic, xAI, Ollama)
- **Theme**: Dark only (navy base `#0f172a`, amber user accent, purple agent accent)

## Repo Layout

```
loom/
├── backend/           # Python — FastAPI server, agents, index, rules, bridge
│   ├── api/           # FastAPI routes
│   ├── agents/loom/   # Weaver, Spider, Archivist, Scribe, Sentinel
│   ├── agents/shuttle/ # Researcher, Standup
│   ├── compiler/      # Prompt Compiler pipeline
│   ├── index/         # LanceDB, embeddings, search
│   ├── rules/         # Rules engine parser
│   ├── bridge/        # GitHub, Email, Calendar integrations
│   └── core/          # Vault management, file watcher, config
├── frontend/          # React — Graph UI
│   ├── views/         # Graph, Board, Thread, Inbox
│   ├── components/    # File tree, sidebar, agent cards, editor
│   └── lib/           # react-force-graph-2d graph logic, react-markdown config
├── docs/              # Architecture docs, reference
├── examples/          # Example vaults, rules, schemas
└── pyproject.toml
```

## Key Concepts

- **Vault**: multi-vault markdown filesystem at `~/.loom/vaults/`. Fixed core folders (daily, projects, topics, people, captures) + user custom folders.
- **Wikilinks**: all inter-note links use `[[note-name]]` syntax.
- **Two-tier agents**: Loom Layer (system: Weaver, Spider, Archivist, Scribe, Sentinel) manages the vault. Shuttle Layer (task: Researcher, Standup) produces content into `captures/`, Loom agents process it.
- **Read-Before-Write**: every agent must read vault.yaml → prime.md → role rules → memory.md → _index.md → related notes BEFORE writing anything.
- **prime.md**: user-owned constitution. Immutable to agents by default.
- **Prompt Compiler**: centralized pipeline that optimizes all prompts before sending to LLM (pruning, compression, token counting, templates).

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

## Conventions

- All notes use YAML frontmatter with `id`, `title`, `type`, `tags`, `created`, `modified`, `author`, `status`, `history` fields.
- Edit history tracked in frontmatter: every mutation logged with `action`, `by`, `at`, `reason`.
- Deletion = archive. Files move to `threads/.archive/`, never truly deleted.
- Agent actions always logged in per-agent-per-day changelog at `.loom/changelog/<agent>/<date>.md`.
- Agents have `memory.md` summarized every 20 actions.
- Chat history saved as markdown: `agents/_council/chat/` for Loom Council, `agents/<name>/chat/` for Shuttle agents.
- Global search bar in top nav + file tree filter bar (separate).
- Graph: force-directed layout, react-force-graph-2d, nodes = dots with labels, edges thicken by density.
- Color split: amber (`#f59e0b`) = user actions, purple (`#a78bfa`) = agent actions.
- Fonts: Sora (UI), JetBrains Mono (code/timestamps).

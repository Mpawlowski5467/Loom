```

  ,,
`7MM
  MM
  MM  ,pW"Wq.   ,pW"Wq.`7MMpMMMb.pMMMb.
  MM 6W'   `Wb 6W'   `Wb MM    MM    MM
  MM 8M     M8 8M     M8 MM    MM    MM
  MM YA.   ,A9 YA.   ,A9 MM    MM    MM
.JMML.`Ybmd9'   `Ybmd9'.JMML  JMML  JMML.
```

A local-first AI memory system with a multi-agent backbone and a visual knowledge graph.

## What it is

Markdown notes, a force-directed graph, and a team of AI agents that organize and link them for you. Everything runs on your machine.

## Agents

**Loom Layer** — manage the vault.

- **Weaver** turns raw captures into structured notes.
- **Spider** finds connections and adds wikilinks.
- **Archivist** flags stale notes, duplicates, and broken links.
- **Scribe** writes folder indexes and daily logs.
- **Sentinel** validates each action.

**Shuttle Layer** — produce content into `captures/`.

- **Researcher** answers questions from your vault.
- **Standup** generates a daily recap.

You chat with Shuttle agents 1:1. The Loom Layer talks back via the **Loom Council**.

Every agent reads before it writes: vault config → `prime.md` → its own memory → target folder → related notes.

## Stack

Python / FastAPI / React / react-force-graph-2d / LanceDB. Provider-agnostic AI (OpenAI, Anthropic, xAI, Ollama).

## Run it

```bash
# Backend
cd backend && pip install -e ".[dev]" --break-system-packages
uvicorn api.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

## Status

In development. See [`docs/architecture-ref.md`](docs/architecture-ref.md) for the full design.

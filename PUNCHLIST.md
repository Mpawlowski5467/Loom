# Foundation Cleanup Punchlist

Tracking the "clean up cracked foundations" pass on 2026-05-23.

## Reality vs. the brief

The brief described a set of broken-state items that, on inspection, do not
match the current repo. The repo is in better shape than the brief implies.
Each task is reconciled below.

### 1. Duplicate config sections — NOT PRESENT
- `backend/pyproject.toml` has exactly one `[project.optional-dependencies]`
  and one `[tool.hatch.build.targets.wheel]`. There is no `[lint.isort]`
  section at all (lint config lives in `backend/ruff.toml`).
- `frontend/tsconfig.app.json` has exactly one `include` key.
- `frontend/package.json` has no duplicate scripts/dependencies/devDependencies.
- **Action:** none. Nothing to fix.

### 2. API client duality — PARTIALLY REAL
- `frontend/src/lib/api/search.ts` does not exist. There is no `frontend/src/lib/`
  directory anywhere.
- `frontend/src/api/search.ts` IS a local in-memory fake (`Math.random` scoring,
  no fetch). It is consumed only by [Palette.tsx](frontend/src/views/Palette.tsx),
  whose footer claims "semantic · LanceDB" — that label is currently a lie.
- Backend has a working `/api/search` route at [search.py](backend/api/routers/search.py)
  (semantic + keyword fallback) with no frontend client wired to it.
- **Action:** replace `frontend/src/api/search.ts` with a real client that calls
  `GET /api/search`. Update Palette to await results. Keep a small client-side
  fallback for the empty-query "recent" list (no point round-tripping for that).

### 3. AppContext duality — NOT PRESENT
- `frontend/src/lib/context/AppContext.tsx` does not exist.
- The only AppContext is [frontend/src/context/AppContext.tsx](frontend/src/context/AppContext.tsx),
  which is wired into [App.tsx](frontend/src/App.tsx) and used everywhere.
- **Action:** none.

### 4. Hardcoded API_BASE — ALREADY ENV-DRIVEN
- `frontend/src/lib/api/common.ts` does not exist.
- [frontend/src/api/client.ts](frontend/src/api/client.ts) at lines 9-15 already
  resolves `API_BASE` from `import.meta.env.VITE_API_BASE` with a
  `http://localhost:8000` fallback.
- `.env.example` at repo root already documents `VITE_API_BASE` (and all backend
  env vars). No separate `frontend/.env.example` needed — Vite reads the
  repo-root `.env` when run from `frontend/`? Actually no — Vite reads from
  the `frontend/` directory by default. **Action:** add a thin
  `frontend/.env.example` that points to the repo-root one.

### 5. backend/.env.example — ALREADY COVERED
- Repo-root `.env.example` already documents `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, plus all `LOOM_*`
  backend settings. A separate `backend/.env.example` would be a duplicate.
- **Action:** add a thin `backend/.env.example` that points to the repo-root
  one (parallel to the frontend stub).

### 6. Docs reconciliation — ALREADY CONSISTENT
- CLAUDE.md and docs/architecture-ref.md both describe:
  - Paper as the default theme, with navy/forest/sepia variants in tokens.css.
  - Sigma.js + graphology for the graph (NOT `react-force-graph-2d` as the
    brief claimed — that library is not in `package.json` and is not mentioned
    in any doc).
  - Custom markdown renderer at `frontend/src/editor/renderMarkdown.tsx`.
- No conflicts to resolve. **Action:** none.

### 7. Stale branches — NEEDS USER DECISION
All `claude/*` branches and `feat/refactor-structure` are local-only and either
fully merged into main (zero unmerged commits) or near-empty:

| Branch                              | Unmerged commits | Notes |
|-------------------------------------|------------------|-------|
| `claude/inspiring-fermi-94c879`     | 0                | safe to delete |
| `claude/silly-noether-3948b2`       | 0                | safe to delete |
| `claude/strange-hopper-6c2edb`      | 0                | safe to delete |
| `claude/update-readme-with-graphs-vezHy` | 1 (`docs: rewrite README with full project overview and Mermaid diagrams`) | unmerged work — confirm before deleting |
| `feat/refactor-structure`           | 0                | already merged via PR #14; remote copy also exists |

**Action:** ask user which to delete (see Open Questions).

### 8. backend/compiler and backend/bridge — DO NOT EXIST
- Neither directory exists in `backend/`. They are not referenced anywhere in
  the docs (CLAUDE.md, architecture-ref.md, style-guide.md, README.md) as
  "real components."
- **Action:** none. (See Open Questions — flagging in case the brief intends
  something else.)

---

## Actions actually taken

1. **search.ts**: replaced fake (`Math.random` scoring) with a real backend
   client (`searchNotesRemote`) that calls `GET /api/search`. Kept a small
   local helper (`recentNotes`) for the empty-query "recent" list — no point
   round-tripping for that.
2. **Palette**: now debounces (150 ms), aborts in-flight requests on input
   change, distinguishes loading / ok / error / recent states in the footer
   ("backend search" / "searching…" / "offline" / "recent"), and falls back
   gracefully when the backend is unreachable. State is keyed by query so
   stale responses can't overwrite a newer search.
3. **frontend/.env.example**: created as a pointer to the repo-root
   `.env.example`.
4. **backend/.env.example**: created as a pointer to the repo-root
   `.env.example` with a note that pydantic-settings reads from process env,
   not from a directory-local `.env`.

Files changed (4):
- `frontend/src/api/search.ts` (rewrite)
- `frontend/src/views/Palette.tsx` (rewrite of state model)
- `frontend/.env.example` (new)
- `backend/.env.example` (new)
- `PUNCHLIST.md` (new, this file)

No commits made — awaiting direction.

## Quality gates

| Gate                                | Result |
|-------------------------------------|--------|
| `ruff check backend/`               | pass (all checks passed) |
| `ruff format --check backend/`      | **fail — pre-existing**, 6 files (see below) |
| `pytest backend/`                   | pass (374 passed in 9.75s) |
| `npm run lint` (frontend)           | pass |
| `npm run test` (frontend, vitest)   | pass (20/20 across 7 files) |
| `npm run build` (frontend)          | pass (vite warns about >500 kB bundle and ineffective dynamic import — both pre-existing) |

**Pre-existing ruff-format debt** (not touched by this session, last modified
in commit `08b0f14`):
- `backend/api/routers/providers.py`
- `backend/api/routers/tree.py`
- `backend/core/providers/anthropic.py`
- `backend/tests/test_api_agents_registry.py`
- `backend/tests/test_api_tree.py`
- `backend/tests/test_security.py`

Decision needed: should I run `ruff format backend/` as a separate
"chore: ruff format" commit to clear the gate? It would touch 6 files
unrelated to this session's work.

## Stale notes in CLAUDE.md

While verifying, two CLAUDE.md "Known gaps" entries are now outdated:
- "Zero frontend tests" — 20 tests now live across 7 files
  (`useLoomConfig.test.ts`, `Wikilink.test.tsx`, `Button.test.tsx`,
  `renderMarkdown.test.tsx`, `AppContext.test.tsx`, `ProviderConfig.test.tsx`,
  `OnboardingFlow.test.tsx`).
- "No `.env.example`" — one exists at repo root (with this session's pointer
  stubs in `frontend/` and `backend/`).

Not edited in this session — flagging for a separate docs cleanup pass.

## Open questions for the user

1. **Branches**: delete the four fully-merged `claude/*` ones
   (`inspiring-fermi-94c879`, `silly-noether-3948b2`, `strange-hopper-6c2edb`,
   plus the merged `feat/refactor-structure`)? Keep, merge, or delete
   `claude/update-readme-with-graphs-vezHy` (it has one unmerged commit:
   "docs: rewrite README with full project overview and Mermaid diagrams")?
2. **Imagined files**: the brief references files that don't exist
   (`frontend/src/lib/...`, `backend/compiler/`, `backend/bridge/`,
   duplicate config sections, `react-force-graph-2d`). Was the brief written
   against a different branch or a different repo state? Should I look
   somewhere else, or treat those items as already-resolved?
3. **Commits**: would you like one commit or several?
   - Option A: one `chore: foundation cleanup` commit (5 files).
   - Option B: two commits — `feat(search): wire Palette to real /api/search`
     (2 files) and `docs: add env stubs and punchlist` (3 files).
4. **Ruff format**: clear the 6 pre-existing dirty files in a separate
   `chore: ruff format backend` commit?

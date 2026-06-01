# Contributing to Loom

Thanks for your interest in Loom. It's an open beta maintained by a solo
developer, so contributions, bug reports, and ideas are all welcome.

This file is the short version. The authoritative references are:

- [`CLAUDE.md`](CLAUDE.md) — project overview, repo layout, conventions, and
  current implementation status.
- [`docs/style-guide.md`](docs/style-guide.md) — the full code style guide
  (Python + React).
- [`docs/architecture-ref.md`](docs/architecture-ref.md) and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the system is designed.

Please skim those before a non-trivial change. What follows is the must-know
distillation.

## Getting set up

```bash
# Backend (Python 3.11+)
cd backend && pip install -e ".[dev]" --break-system-packages
uvicorn api.main:app --reload --port 8000

# Frontend (Node 18+; CI uses 22)
cd frontend && npm install
npm run dev          # http://localhost:5173
```

New to the project? [`docs/getting-started.md`](docs/getting-started.md) walks
through Loom from a user's perspective first.

## Before you open a PR

CI runs three jobs — backend, frontend, and a Docker build + smoke test. Run the
backend and frontend checks locally so green stays green:

```bash
# Backend
ruff check backend/
ruff format --check backend/
cd backend && pytest

# Frontend
cd frontend && npm run lint
cd frontend && npm run test:run
cd frontend && npm run build
```

## Conventions (the load-bearing ones)

**Commits & branches**

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- One logical change per commit.
- Branch naming: `feat/<description>`, `fix/<description>`.

**Python**

- Type hints on every function signature; Google-style docstrings on public
  functions/classes. `ruff` for both lint and format (not black/flake8).
- `pathlib.Path` over `os.path`; `pydantic` for config/data models; async by
  default for FastAPI routes and I/O.
- **All vault file operations go through `backend/core/vault.py`** — never read
  or write vault files directly from a route or an agent.
- Custom exceptions live in `backend/core/exceptions.py`. Agents log errors to
  their own `logs/`; never raise silently to the user.
- Tests: `pytest` + `pytest-asyncio`, mirroring source layout
  (`tests/api/`, `tests/agents/`, `tests/core/`), named `test_<module>.py`.

**React / TypeScript**

- Functional components and hooks only; TypeScript everywhere; strict mode.
- **All colors come from `tokens.css` CSS variables** — never hardcode a hex.
  A new color must be added to *every* theme block (paper/navy/forest/sepia).
- API calls go through the shared client in `frontend/src/api/` (use `fetch`,
  not axios). Global state via React Context — no Redux/Zustand.
- Tests colocated next to source (`Foo.tsx` → `Foo.test.tsx`), using Testing
  Library (`getByRole` > `getByText` > `getByTestId`). Mock HTTP with `vi.fn()`
  spies on the API client — never hit the real network. Test behavior, not
  implementation; skip snapshot tests.

**Vault markdown**

- YAML frontmatter required on every note; `##` headers mark sections (they're
  the embedding chunk boundary); internal links use `[[wikilinks]]`, never
  standard Markdown links; one concept per file.

**File sizes** (split when exceeded)

- Files < 300 lines · functions < 50 lines · components < 200 lines.

## Reporting bugs & requesting features

Use the GitHub issue templates (Bug report / Feature request). For security
issues, see [`SECURITY.md`](SECURITY.md) — please don't include secrets in an
issue.

## Scope & status

Loom is pre-1.0. Check the **Implementation Status** section of
[`CLAUDE.md`](CLAUDE.md) for what's shipped, in flight, and known-gap before
proposing large changes, so effort lands where it helps.

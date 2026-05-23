# Loom — Code Style Guide

## Python (Backend)

### General
- Python 3.11+ required
- Use `ruff` for linting and formatting (not black, not flake8)
- Type hints on all function signatures — no exceptions
- Docstrings on all public functions and classes (Google style)
- Use `pathlib.Path` over `os.path` everywhere
- Use `pydantic` for data validation and config models
- Async by default for all FastAPI routes and I/O operations

### Naming
- Files: `snake_case.py`
- Classes: `PascalCase`
- Functions/variables: `snake_case`
- Constants: `UPPER_SNAKE_CASE`
- Private: prefix with `_`

### Imports
- Standard library first, blank line, third-party, blank line, local
- Use absolute imports from the package root
- No wildcard imports (`from x import *`)

### Project Patterns
- FastAPI routes go in `backend/api/` with one router per resource
- Agent logic goes in `backend/agents/loom/` or `backend/agents/shuttle/`
- All vault file operations go through `backend/core/vault.py` — never read/write vault files directly from routes or agents
- Config loaded via pydantic models from `backend/core/config.py`
- Use dependency injection for FastAPI (providers, vault instance, index)

### Error Handling
- Use custom exception classes in `backend/core/exceptions.py`
- FastAPI exception handlers for consistent error responses
- Agents log errors to their own `logs/` folder, never raise to the user silently

### Testing
- `pytest` with `pytest-asyncio` for async tests
- Test files mirror source structure: `tests/api/`, `tests/agents/`, `tests/core/`
- Name test files `test_<module>.py`
- Use fixtures for vault setup and teardown

---

## React (Frontend)

### General
- Functional components only — no class components
- Hooks for all state management (useState, useEffect, useReducer, useContext)
- TypeScript everywhere — no `.js` files in frontend
- Strict mode enabled

### Naming
- Files: `PascalCase.tsx` for components, `camelCase.ts` for utilities
- Components: `PascalCase`
- Hooks: `useCamelCase`
- Props interfaces: `ComponentNameProps`
- CSS classes: kebab-case

### Styling
- CSS Modules (`.module.css`) for component-scoped styles where they exist; view-level styles under `frontend/src/styles/views/`
- All colors come from `tokens.css` CSS variables — never hardcode hex values
- Paper theme is the default; navy/forest/sepia ship in `tokens.css` under `.theme-*` classes. New colors must be added to every theme block.

### Project Patterns
- Views go in `frontend/src/views/` — one file per view (GraphView, BoardView, InboxView, ThreadView)
- Reusable components go in `frontend/src/components/`
- Sigma.js graph logic isolated in `frontend/src/graph/`
- Markdown rendering lives in `frontend/src/editor/renderMarkdown.tsx`
- API calls go through clients in `frontend/src/api/` (one file per resource, shared error handling in `client.ts`)
- Use `fetch` via the shared client — no axios

### State Management
- React Context for global state (active vault, current note, sidebar state)
- Local state with `useState` for component-level concerns
- No Redux, no Zustand — keep it simple until complexity demands it

### File Structure Per Component
```
components/
├── FileTree/
│   ├── FileTree.tsx
│   ├── FileTree.module.css
│   └── index.ts          # re-export
```

---

## Shared Conventions

### Git
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- One logical change per commit
- Branch naming: `feat/<description>`, `fix/<description>`

### Markdown (Vault Files)
- YAML frontmatter required on all vault notes
- `##` headers for sections (smart chunking boundary for embeddings)
- `[[wikilinks]]` for inter-note links — never standard markdown links for internal references
- One concept per file (atomic notes)

### File Sizes
- Keep files under 300 lines. Split if larger.
- Keep functions under 50 lines. Extract if larger.
- Keep components under 200 lines. Extract sub-components if larger.

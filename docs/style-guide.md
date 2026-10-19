# Loom — Code Style Guide

## Python (Backend)

### General
- Python 3.12 required
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
- Vault lifecycle (create/switch/list vaults) goes through `backend/core/vault.py`; all vault note **writes** go through the `backend/core/vault_io.py` chokepoint (`write_note`/`write_text`, which validate the path stays under `threads/`, isn't `.archive/`, and isn't `rules/prime.md`) — never `open()`/`write_text` vault files directly from routes or agents
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
- Tailwind v4 utilities on shadcn/ui primitives (`src/components/ui/`, added with the shadcn CLI, new-york style). Merge class names with `cn()` from `@/lib/utils`; reach for an existing primitive (Button, Select, Dialog, Popover, Tooltip, ToggleGroup, …) before writing markup
- All colors come from the theme tokens in `src/styles/themes.css` — never hardcode hex (eslint enforces this in UI code). Tailwind's default palette is disabled, so use token utilities: `bg-background`, `text-muted-foreground`, `bg-brand`, `border-border-strong`, `bg-chip`
- Graphite is the default theme; Paper, Midnight, Forest, Linen and High contrast complete the set. A new token goes into every theme block and must pass `src/theme/contrast.test.ts` (WCAG AA)
- Code that can't read CSS (Sigma.js) gets colors from `useThemeColors()`
- Fonts: Geist (`font-sans`, UI), Geist Mono (`font-mono`, paths, hashes, keyboard hints, timestamps), and `font-editor` for note text (the user's editor font)
- Icons from lucide-react; no emoji in the UI
- Every control is keyboard-reachable with a visible `--ring` focus ring
- `src/styles/views/*.css` and `legacy-tokens.css` exist only for screens not yet rebuilt; don't add new rules there

### Project Patterns
- Views go in `frontend/src/views/` — one entry file per view (GraphView, NotesView, BoardView, InboxView, ThreadsView); a rebuilt view's parts live in a folder beside it (`views/graph/`, `views/notes/`)
- Reusable components go in `frontend/src/components/`
- Sigma.js graph logic isolated in `frontend/src/graph/`; translucent colors handed to Sigma go through `glColor()` (its WebGL blending is premultiplied)
- Markdown preview lives in `frontend/src/editor/Markdown.tsx` and uses `react-markdown`; style read-only previews with `MARKDOWN_PROSE` (`editor/markdownProse.ts`); editor-specific helpers live beside it
- API calls go through clients in `frontend/src/api/` (one file per resource, shared error handling in `client.ts`)
- Use `fetch` via the shared client — no axios

### State Management
- React Context for global state (active vault, current note, sidebar state)
- Local state with `useState` for component-level concerns
- No Redux, no Zustand — keep it simple until complexity demands it

### File Structure Per Component
One component per file, grouped by area, with its test beside it:
```
components/
├── ui/                   # shadcn primitives (generated; edit sparingly)
├── shell/
│   ├── AppHeader.tsx
│   ├── AppHeader.test.tsx
│   └── useGlobalShortcuts.ts
```
Import from `src` with the `@/` alias (`@/components/ui/button`).

### Frontend Testing
- Test files colocated next to source: `Foo.tsx` -> `Foo.test.tsx`
- Pure utility functions: `utils.ts` -> `utils.test.ts`
- Use Testing Library queries: `getByRole` > `getByText` > `getByTestId` (last resort)
- Mock HTTP via `vi.fn()` spies on the API client; never hit real network
- Test behavior, not implementation: render, interact, assert visible output. Skip snapshot tests.

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

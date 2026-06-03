# Changelog

All notable changes to Loom are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-06-01

Resilience, correctness, and approachability pass. Loom now survives the common
real-world failures instead of breaking silently, proves its core pipeline with
an end-to-end test, and ships the docs a newcomer needs. Still open-beta quality
and local-first — see the README "Known gaps".

### Added
- **Provider retry with backoff** — transient failures (Ollama cold-start, a
  network blip, a 429) now retry with bounded exponential backoff + jitter at the
  `TracedProvider` chokepoint, so one hiccup no longer fails a whole search or
  blocks re-indexing. OpenRouter's own rate-limit loop is left untouched (no
  double-wrapping), and streams retry only at connection, never mid-stream.
- **Index-drift detection and recovery** — a note whose embedding failed used to
  land in the metadata index but never in the vector store, invisible to search
  forever. The watcher now tracks failed notes and retries them, a startup
  reconciliation pass compares metadata against vectors, the health report
  exposes an `unindexed` count, and the UI shows a "notes unindexed / rebuilding"
  banner.
- **Idempotent capture processing** — re-running the pipeline on a capture whose
  note already exists (e.g. after a crash between note-write and archive) no
  longer creates a duplicate; it detects the existing note by capture id and just
  finishes archiving.
- **Token-aware truncation** — agent prompts (Weaver, Sentinel, related-note
  context) and the per-agent memory summarizer now cap by real token count
  (tiktoken, with a character-based fallback) instead of raw character slices, so
  dense notes can't silently blow the context window. The memory summarizer input
  is hard-capped.
- **End-to-end pipeline test** — a real capture → Weaver → index → search test
  (with stub chat + embedder) that proves the whole pipeline composes, plus
  assertions for drift reconciliation and idempotency. This is the regression net
  the resilience work hangs off of.
- **Accessible boot + confirmations** — the boot screen now times out after 10s
  with a Retry/offline fallback instead of an infinite spinner, and ThreadView's
  discard-unsaved and archive prompts use an accessible modal instead of
  `window.confirm`.
- **User-facing documentation** — a Getting Started guide
  (`docs/getting-started.md`), `CONTRIBUTING.md`, `SECURITY.md`, and GitHub issue
  templates.
- **Targeted backend tests** for the provider-validation and onboarding routers,
  the council SSE stream's mid-stream error frame, and the spider error path.

### Changed
- **Docker is safe-by-default** — `docker compose` now binds the published port to
  `127.0.0.1` (this machine only) rather than the LAN, since Loom ships no auth.
  Exposing it deliberately is documented in `SECURITY.md`.
- **AppContext value is memoized** — the context value object is no longer
  recreated every render, removing a re-render storm across all consumers (felt
  jank with the graph in the tree).
- Docs corrected: custom-agent execution is documented (and described in the UI)
  as shipped; the README LICENSE reference and Docker quickstart are accurate.

### Fixed
- Custom-agent "Add agent" modal copy no longer claims execution is "coming in a
  future ticket" — it ships and the modal now describes the real behavior.
- Backend lint/format brought fully green (`ruff check` + `ruff format --check`).

### Security / known limitations
- Provider API keys are still stored unencrypted in `config.yaml` (documented,
  intentional for this release). The API still has no auth — safe on a loopback
  bind, unsafe if exposed. See `SECURITY.md`.

## [0.4.0] - 2026-05-31

First versioned release. Loom is a working, locally-runnable product — open
beta quality. See the README "Known gaps" for what is not yet hardened
(notably: provider keys are stored in plain text, and the API has no auth
layer — safe on localhost, do not expose the port as-is).

### Added
- **One-command Docker run** — a multi-stage build produces a single container
  that serves the UI and API on one port. `docker compose up`, then open
  <http://localhost:8000>. Vaults persist in a named volume.
- **Custom-agent execution** — user-defined Shuttle agents created from the
  Board now actually run: a run dispatches to `CustomAgent`, which gathers
  vault context, calls the chat provider with the agent's system prompt, and
  writes a capture for triage. Previously the registry + modal existed but
  running errored.
- **Follow-OS theme mode** — an app-wide toggle that tracks the system
  light/dark preference and switches themes on OS change and at startup.
- **Reset-to-defaults** for typography/density/motion, and the theme picker is
  now grouped into Light and Dark sections.
- **Comprehensive frontend test suite** — views (Graph/Board/Inbox/Thread),
  graph logic (reducers, layouts, frame loop, breathing, drag physics), the
  API client layer, the full settings tree, theme/appearance, and the SSE
  council stream parser.
- Backend tests for the custom-agent executor and runner dispatch.

### Changed
- The UI density control now actually changes spacing (it was wired to an
  unused CSS variable), via a `--space-scale` token threaded through the
  structural surfaces.
- Status docs (README, CLAUDE.md) corrected to reflect that custom-agent
  execution ships and the frontend is well-tested.

### Fixed
- **Note overwrite** — the create-note direct-write fallback no longer
  clobbers an existing note whose title kebabs to the same filename; it now
  dedupes like the Weaver path (deletion = archive, never silent loss).
- **Create-then-edit** — newly created notes open directly in the editor,
  ready to type, instead of a read-only view of an empty note.
- **Motion "Always on"** now has CSS to override the OS reduce-motion
  preference (it was previously inert for the users who'd pick it).
- **Provider connection test** — a thrown error during "Test" now surfaces as
  a failed result instead of a silently stuck spinner.
- **Same-origin API base** — an empty `VITE_API_BASE` is now honored as
  "same origin" (relative `/api`), which the single-container build relies on.

### Security / known limitations
- Provider API keys are stored unencrypted in `config.yaml`. A warning is shown
  in-app and in the README; OS-keychain support is not yet implemented.
- No authentication on the API. Intended for local use only.

[0.5.0]: https://github.com/Mpawlowski5467/Loom/releases/tag/v0.5.0
[0.4.0]: https://github.com/Mpawlowski5467/Loom/releases/tag/v0.4.0

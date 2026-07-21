# Changelog

All notable changes to Loom are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **GitHub Bridge adapter** — configured repositories are polled on an
  interval for new commits, issues, and PRs (`backend/bridge/github*.py`).
  Activity lands in the Inbox through the unified capture ingress with
  external-ID idempotency (`github:<repo>:<kind>:<id>`), so producer retries
  never duplicate work. The personal access token is Fernet-encrypted at rest
  like provider keys; per-repo cursors (`github-sync.json`) bound each poll,
  and a background poller re-reads config every tick so Settings edits apply
  live. `/api/automations/github/*` exposes redacted config + poller status,
  a per-repo connection test, and a manual sync; a Connections settings card
  drives it all. Token-based polling only — no webhooks (Loom is
  localhost-first); one repo's failure never sinks the sync.
- **Email Bridge adapter** — a configured IMAP mailbox is polled on an
  interval for new mail (`backend/bridge/email*.py`). Messages land in the
  Inbox with Message-ID/UID external-ID idempotency; the mailbox is opened
  read-only and fetched with `BODY.PEEK`, so Loom never marks mail as seen.
  The app password is Fernet-encrypted at rest; a UID cursor
  (`email-sync.json`) bounds each poll; a background poller mirrors the
  GitHub one. `/api/automations/email/*` plus a Connections settings card.

### Fixed
- **`/process-all` timeout parity** — bulk processing now bounds each
  pipeline run with the same server-side cap as single `/process` (900s),
  so one stalled capture can't hold the whole batch (or its durable jobs)
  hostage.

## [1.1.0] - 2026-07-19

Loom 1.1 — the automation-and-reliability release. Captures process through a
durable, restart-safe job queue with a review lane; Standups run on a
timezone-aware schedule enriched by a read-only iCalendar Bridge; vaults
export/import with atomic rollback. A full live verification pass (real
server, real local models) then hardened the seams it found: stalled-provider
runs can no longer wedge a capture job, provider settings saves no longer kill
in-flight pipelines, and Ollama chat streams internally so slow-but-steady
local models — including reasoning models like deepseek-r1 — complete instead
of timing out.

### Added
- **Durable Inbox processing** — captures are processed through a per-vault
  SQLite job queue (`core/capture_jobs.py`) with bounded exponential-backoff
  retries, cancel, manual retry, a needs-review lane, retention controls, and
  Active/Review/History views in the Inbox. Queued work and terminal outcomes
  survive restarts; rows interrupted by a crash are recovered on startup.
- **Unified capture ingress** — one ingress path (`core/capture_ingress.py`)
  for HTTP, Shuttle agents, and Bridge sources, with external-ID idempotency,
  provenance validation, indexing, durable job creation, and typed live events.
- **Scheduled Standup workspace** — timezone-aware durable scheduling for
  Standup recaps (`core/standup_scheduler.py`, `/api/automations/standup`)
  with a Board-side workspace UI.
- **iCalendar Bridge** — an encrypted, read-only private iCalendar feed
  connection (`backend/bridge/`) that enriches scheduled Standups and creates
  idempotent event captures in the Inbox (`/api/automations/calendar/*`).
- **Bounded vault export/import** — size-bounded, disk-streamed vault export
  and import with an atomic staged swap, rollback, and startup recovery for
  interrupted overwrites.
- **Note archival hardening** — archival and restore share the edit lock,
  support optimistic version checks, and restore the exact original on a
  failed move.

### Changed
- **`docker compose up` is single-container again** — the Redis and Postgres
  services moved behind the `full` compose profile (`docker compose --profile
  full up`), and `LOOM_REDIS_URL` / `LOOM_DATABASE_URL` now default to empty
  (disabled) instead of being injected unconditionally; the backend treats an
  empty URL exactly like unset.
- **Pinned backend dependencies** — `backend/requirements.lock` is the pinned
  dependency set for reproducible Docker builds; the Dockerfile installs the
  lock before installing the project itself with `--no-deps`.

### Fixed
- **Watcher reconcile-timer generation guard** — a watcher stop/restart can no
  longer orphan a reconcile timer chain that would index the old vault into
  the new vault's vector store; `start_watcher` cancels pre-existing timers.
- **Note rename write ordering** — note updates validate rename-target
  collisions before persisting, so a 409 leaves the on-disk note
  byte-identical.
- **Notes-load error state** — GraphView surfaces notes-fetch failures as an
  error state instead of the misleading "empty vault" prompt.
- **Memoized graph keys** — structural/content keys are memoized on notes so
  unrelated context re-renders no longer re-sort every node id and edge.
- **Capture-job retry budget** — synchronous `/process` / `/process-all`
  reservations no longer consume the background backoff budget (`attempts`
  counts worker claims only), so a recovered job gets its full retry sequence
  instead of going terminal on the first transient failure.
- **Token gate vs. CORS preflight** — the optional `LOOM_API_TOKEN` gate no
  longer 401s CORS preflight `OPTIONS` requests, so the cross-origin dev SPA
  keeps working when a token is configured.
- **Healthchecks hit readiness** — the Docker `HEALTHCHECK` and the CI smoke
  test now probe `/api/ready` (503 on unready components) instead of the
  always-200 liveness endpoint.
- **`LOOM_HOME` env var is honored** — `LoomSettings.loom_home` previously
  derived `LOOM_LOOM_HOME` from the class env prefix, silently ignoring the
  `LOOM_HOME` set by the Dockerfile and compose; the container wrote vaults to
  `~/.loom` instead of the mounted `/data` volume. The field now names
  `LOOM_HOME` explicitly (the derived name stays accepted).
- **Stalled providers can no longer wedge a capture job** (#25, #26) — the
  synchronous `/api/captures/process` now bounds the pipeline server-side
  (900s); on timeout the durable job is finalized `failed` with a
  retry-in-background hint instead of sitting in `running` until a restart.
  Root cause: uvicorn does not cancel the request handler on client
  disconnect, so an unbounded parked pipeline was unrecoverable in-process.
- **Ollama chat streams internally** (#25) — with `stream=false` the whole
  generation had to fit the 120s httpx read window, so slow local models
  timed out mid-generation and reasoning models (deepseek-r1, thinking-mode
  Qwen) never survived a pipeline. `chat()` now consumes the streaming
  endpoint and assembles the answer (reasoning `thinking` chunks excluded);
  the read timeout is a between-chunks stall detector again. Verified live:
  deepseek-r1:32b completes a full capture pipeline.
- **Provider settings saves no longer kill in-flight runs** (#28) —
  `reset_registry()` retires instead of closing: a reaper closes each old
  provider's httpx client only after its calls drain plus a 60s quiescence,
  so an unrelated settings edit can't amputate a running pipeline with
  "client has been closed".
- **Watcher/Spider tolerate archived-mid-flight files** (#27) — a capture
  enforce-archived between an fs event and the index attempt (or a stale
  title-map entry mid-scan) is skipped quietly instead of logging a
  `FileNotFoundError` and polluting the drift counter.

## [1.0.0] - 2026-06-21

Loom 1.0 — the resilience-and-honesty milestone. The 0.x line proved the product
end-to-end; 1.0 makes it dependable and makes its docs tell the truth. The agent
work runs as observable LangGraph graphs with run/step tracing, provider keys are
encrypted at rest, and an optional shared-token gate guards a deliberately-exposed
port. Type-checking now gates CI with the backlog cleared to zero, and an
end-to-end test drives the capture pipeline through the real HTTP routers. The
architecture docs were split so the reference describes only what ships — planned
work (the Bridge, Prompt Compiler, attachments) now lives in `docs/VISION.md`.
Loom stays deliberately local-first and unauthenticated by default; the README
"Known gaps" lists those v1 boundaries.

### Added
- **LangGraph agent orchestration** — the capture pipeline and the Shuttle
  agents now run as LangGraph `StateGraph`s instead of imperative call chains.
  The pipeline (`agents/loom/pipeline_graph.py`) is
  `weaver → spider → scribe → sentinel → enforce` with conditional edges: it
  short-circuits an empty capture and **loops back to Weaver once on a `failed`
  Sentinel verdict** (regenerate → re-validate, then enforce regardless).
  Researcher (`search → synthesize → save`) and Standup
  (`collect → generate/skip → save`) are graphs too. Graph nodes wrap the
  existing agent methods (read-before-write, changelog, and memory still fire)
  and call Loom's own provider layer — LangGraph orchestrates only, so **no
  LangChain model objects** are pulled in. Adds `langgraph>=0.2`.
- **Runs observability** — every trace is tagged with the `run` and `step` it
  belongs to, and a run summary (ordered steps, including no-LLM steps like
  Spider's deterministic linking and `enforce`) is written to
  `.loom/traces/<date>/run-<id>.json`. New `GET /api/traces/runs` and
  `GET /api/traces/runs/{id}` endpoints, plus a Board **Runs** view (`RunFeed`)
  that shows a multi-step run as one connected timeline you can drill into per
  step. The flat `/api/traces` view is unchanged.

### Changed
- `POST /api/captures/process` now drives the capture pipeline through
  `AgentRunner.run_pipeline` (the LangGraph pipeline) instead of an inline
  Weaver + finalize chain. Response shape is unchanged.
- **Type-checking gates CI, and v1 test coverage expanded** — the strict-`mypy`
  backlog was cleared to zero (targeting Python 3.12, the Docker/CI runtime) and
  CI no longer runs it `continue-on-error`. Added a router-level end-to-end smoke
  test (drop a capture → `POST /api/captures/process` → assert the note surfaces
  in `/api/graph` and `/api/search`, with a stub chat + embedder) and component
  tests for the New Note modal, the Cmd+K palette, and the Board pulse view.
- **Architecture docs describe only what ships** — the planned Bridge, Prompt
  Compiler, and file-attachments designs (and the v2+ roadmap) moved out of
  `docs/ARCHITECTURE.md` into a new `docs/VISION.md`; `README.md` and
  `docs/architecture-ref.md` point at both.

### Security
- **Provider API keys encrypted at rest** — keys in `config.yaml` are now
  encrypted with Fernet (AES-128-CBC + HMAC) under a machine-local master key
  (`~/.loom/.secret.key`, or the `LOOM_SECRET_KEY` env var), written with an
  `enc:v1:` prefix; legacy plaintext keys are transparently re-encrypted on the
  next save. This is defense-in-depth against casual disclosure of the config
  file (backups, screen-shares) — **not** a substitute for the still-absent API
  auth, and there is no OS-keychain integration yet. See `SECURITY.md`.
- **Optional API token gate** — setting `LOOM_API_TOKEN` requires a matching
  token on every `/api/*` request except the health/readiness probes, accepted as
  `Authorization: Bearer <token>` or `X-Loom-Token` and compared in constant time.
  Unset by default, so the localhost posture is unchanged. It is a speed bump for
  a deliberately-exposed port, **not** real auth — keep the reverse proxy. See
  `SECURITY.md`.

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

[Unreleased]: https://github.com/Mpawlowski5467/Loom/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Mpawlowski5467/Loom/releases/tag/v1.1.0
[1.0.0]: https://github.com/Mpawlowski5467/Loom/releases/tag/v1.0.0
[0.5.0]: https://github.com/Mpawlowski5467/Loom/releases/tag/v0.5.0
[0.4.0]: https://github.com/Mpawlowski5467/Loom/releases/tag/v0.4.0

# Changelog

All notable changes to Loom are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.4.0]: https://github.com/Mpawlowski5467/Loom/releases/tag/v0.4.0

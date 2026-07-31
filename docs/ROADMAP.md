# Loom Roadmap

This roadmap starts from the current product, not the original concept deck.
Loom 1.1.0 is the latest tagged release; the current worktree is an open-beta
release candidate with Google Calendar + Gmail and Outlook Calendar connectors
added but not yet live-validated.

## Release objective

Ship the next open-beta release as a trustworthy local-first application:
installable in one command, honest about its security boundary, recoverable
when agent work fails, and understandable without reading the source.

If the connector scope stays intact, **1.2.0** is the natural next version. The
version number should be confirmed only after the release gates below pass.

## Now — release hardening

These are release gates, in priority order.

Completed during the 2026-07-30 audit:

- The splash, footer, and About panel now share the package-derived
  `VITE_APP_VERSION`.
- Google and Outlook setup cards now derive callback URLs from the configured
  API origin instead of fixing them to `localhost:8000`.

Remaining release gates:

1. **Complete real OAuth validation.** Create the Google and Microsoft app
   registrations, connect one real test account to each, verify token refresh,
   reconnect/disconnect, incremental cursor recovery, multi-calendar selection,
   and duplicate-free Inbox ingestion.
2. **Correct clean-install health behavior.** The image builds and serves the
   UI, but `/api/ready` returns 503 before onboarding because no vault/indexer or
   agents exist; the Docker health check therefore trends unhealthy during the
   exact first-run state. Split liveness from operational readiness, or make the
   container health check onboarding-aware.
3. **Establish a formatting baseline.** Python formatting passes. The frontend
   Prettier check currently reports 81 files, while CI does not run it. Land one
   isolated formatting-only change, then add `npm run format:check` to CI so the
   gate remains meaningful.
4. **Run the final release matrix.** Repeat backend lint/format/type/tests,
   frontend lint/test/build/audit, Docker build, clean-volume onboarding, demo
   vault import, capture processing, archive/restore, and export/import on macOS,
   Linux, and Windows/WSL where supported.
5. **Cut the release deliberately.** Confirm one version across Python,
   JavaScript, API, UI, changelog, and tag; publish the screenshots and trailer;
   then create release notes from `CHANGELOG.md`.

## Next — product reliability and speed

- **Browser-level critical-path tests.** Put onboarding, create/capture/process,
  review, note edit/archive, provider failure, and connector reconnect into the
  Playwright suite and run the smoke subset in CI. The current browser suite is
  concentrated on graph selection and performance.
- **Large-vault performance.** Profile initial load, file-tree rendering,
  search, and graph interaction at 1k/5k/10k notes. Virtualize the file tree and
  keep animation degradation explicit rather than relying only on graph-size
  heuristics.
- **Frontend code splitting.** The production JavaScript bundle is about
  1.05 MB minified (305 KB gzip), and the agent-registry dynamic import is
  ineffective because the module is also imported statically. Split settings,
  onboarding, Board details, and heavy graph controls by route or feature.
- **State ownership.** Continue moving vault, capture, health, config, and event
  behavior out of the `AppContext` compatibility shell into focused domain
  hooks, with direct tests for the remaining `useGraph*` hooks and Board child
  components.
- **Queue recovery UX.** Surface the capture watchdog's stalled-step evidence,
  distinguish retryable provider failures from schema review, and make the
  recommended next action clear in the Inbox.
- **Backup confidence.** Add a visible last-export signal, periodic backup
  reminders, and a full restore drill using a real multi-vault fixture.
- **Accessibility.** Complete keyboard and screen-reader passes for the graph
  alternatives, modals, the Inbox queue, settings forms, and agent run state.

## Later — open ecosystem

- A versioned Bridge/plugin contract with explicit permissions, rate limits,
  secrets handling, cursor ownership, and capture-shape compatibility.
- The Prompt Compiler once real trace data demonstrates which repeated context
  and prompt construction should be centralized.
- Attachment ingestion for images, PDF, office documents, and source files,
  always anchored by a Markdown note and recoverable original.
- OS-keychain-backed secret storage, with migration from the existing encrypted
  config values.
- Authentication, TLS, and multi-user authorization only if Loom intentionally
  expands beyond its loopback, single-user boundary.

## Explicitly out of the next release

- General multi-user or internet-hosted operation
- A stable third-party plugin ABI
- GitHub webhooks for a localhost-first deployment
- Non-Markdown files as first-class vault notes
- Mobile or hosted sync

## Release scorecard

The next release is ready when:

- all required automated checks pass from a clean checkout;
- the Docker image is healthy both before and after onboarding;
- Google and Outlook complete the real-account test matrix;
- no version or callback URL is hard-coded in a user-facing surface;
- first-run, capture-to-note, review, backup, and restore have browser-level
  smoke coverage;
- the changelog, README, architecture guide, screenshots, and trailer match the
  shipped build.

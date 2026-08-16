# Loom Roadmap

Loom 1.1.0 is the latest tagged release. The current worktree is the next
open-beta release candidate, including Google Calendar + Gmail, Outlook
Calendar, GitHub device authorization, and Moonshot/Kimi.

## Release objective

Ship the next beta as a trustworthy local-first application: installable in one
command, honest about its security boundary, recoverable when agent work fails,
and measurable beyond unit-test volume. If the connector scope stays intact,
1.2.0 is the natural version; confirm it only after every release gate passes.

## Automated hardening completed

- Process liveness is separate from operational readiness. Docker uses
  `/api/live`, so a clean pre-onboarding container is healthy while `/api/ready`
  still reports component state.
- Ruff, mypy, pytest, Prettier, ESLint, Vitest, the production build, a
  deterministic semantic agent-quality evaluation, and a real export/restore
  drill gate CI.
- Playwright covers onboarding → demo capture review → filed note → rename →
  archive → restore and runs an axe serious/critical accessibility scan.
- Major views and modal surfaces are code-split. Custom-agent and Council state
  moved from the AppContext compatibility shell into directly tested hooks.
- Capture failures expose a category and recommended recovery action in Inbox
  History and detail views.
- Vault Settings show the last successful export and a 30-day backup reminder;
  a temporary multi-vault restore drill verifies archive integrity.
- Large-vault coverage includes a 1,000-note regression and a provider-free
  1k/5k/10k benchmark. Unseen file-tree folders default closed at 1,000+ notes.
- A headed Chromium profile exercises 5k/10k graph construction and expanded
  file-tree behavior; large folders reveal notes in bounded 200-row pages.
- Graph navigation, selection, filter/display persistence, and camera fly-to
  state moved out of `AppContext` into a directly tested domain hook.
- A provider-free real-backend drill exercises durable failure/retry, export,
  failed-import rollback, restore, and imported-job cleanup through FastAPI.
- Settings diagnostics expose localhost/custom-host scope, optional API-token
  state, encrypted secret-storage mode, and unsafe-exposure warnings.
- A manual/monthly GitHub Actions matrix exercises Linux, macOS, and Windows.
- Frontend dependency audit findings are zero after upgrading patched tooling.

## Remaining release gates

1. **Complete real OAuth validation.** Create the Google, Microsoft, and GitHub
   app registrations, connect dedicated test accounts, and complete
   [OAUTH-RELEASE-VALIDATION.md](OAUTH-RELEASE-VALIDATION.md). Preserve the JSON
   evidence for refresh, reconnect, multi-calendar behavior, cursor recovery,
   and duplicate suppression.
2. **Run and record the hosted release matrix.** Trigger `Release matrix`, then
   record green Linux/macOS/Windows results. Run a manual WSL smoke pass if WSL
   is included in the support promise; GitHub's hosted Windows runner is native
   Windows, not WSL.
3. **Complete the product release drill.** From a clean checkout and clean
   volume: onboard, import the demo vault, process and review a capture, edit and
   archive/restore a note, export and restore a vault, and reconnect one Bridge.
4. **Cut the release deliberately.** Confirm one version across Python,
   JavaScript, API, UI, changelog, and tag. Refresh screenshots/trailer only if
   the shipped UI changed materially, then publish release notes.

## Next — product reliability and speed

- Track the 5k/10k browser-profile history across representative hardware and
  tighten budgets once enough samples make the thresholds stable.
- Extend browser coverage to queue retry, backup download/import, and connector
  reconnect. The deterministic smoke now covers note rename/archive/restore and
  a visible provider failure; a real-backend version remains part of the clean
  release drill.
- Continue splitting `AppContext`; shell layout, modal, and toast ownership are
  the next useful seams after graph display/navigation moved out.
- Tune Scribe phrasing and broaden Sentinel's AI-assisted validation corpus with
  anonymized real captures. Keep the deterministic evaluator versioned as
  prompts and schemas change.
- Validate the optional OS-keychain backend across native macOS, Windows, and a
  Linux Secret Service session; encrypted-file fallback and migration behavior
  are covered deterministically in CI.

## Later — open ecosystem

- A versioned Bridge/plugin contract with permissions, rate limits, secrets
  handling, cursor ownership, and capture-shape compatibility.
- The Prompt Compiler once trace data demonstrates which repeated context and
  prompt construction should be centralized.
- Attachment ingestion for images, PDF, office documents, and source files,
  anchored by a Markdown note and recoverable original.
- Authentication, TLS, and multi-user authorization only if Loom intentionally
  expands beyond its loopback, single-user boundary.

## Explicitly out of the next release

- General multi-user or internet-hosted operation
- A stable third-party plugin ABI
- GitHub webhooks for a localhost-first deployment
- Non-Markdown files as first-class vault notes
- Mobile or hosted sync

## Release scorecard

The next release is ready when all automated checks pass from a clean checkout,
the Docker image is healthy before and after onboarding, the real-account OAuth
matrix and hosted OS matrix have evidence, the product release drill succeeds,
and README/architecture/changelog/media match the shipped build.

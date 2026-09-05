# Review implementation progress

Scope: implement the actionable recommendations in the September 5 project review, preserving the existing PR #31 work. Public plugins, hosted multi-user operation, and additional themes remain intentionally deferred as recommended. Live OAuth consent requires user-owned accounts; no mocked check will be reported as live validation.

Working branch: `codex/review-improvements`, based on `8d00307` (includes local main and the four unmerged release commits).

- [x] Correct editor draft loss, conflict recovery, tags and link completion.
- [x] Resolve slug/title/path/alias links consistently, including ambiguity and heading navigation.
- [x] Enforce publication state for rejected/pending capture drafts.
- [x] Correct nested-folder writes and missing-keychain recovery.
- [x] Load metadata first, fetch bodies on demand, and preserve unchanged notes during refresh.
- [x] Improve full-text + vector retrieval and connector external-ID lookup.
- [x] Handle long captures without silent source truncation; expand quality fixtures.
- [x] Add Quick Capture, Today/pinned projects, and persistent note navigation.
- [x] Add recoverable revisions, conflict-safe restore and undo of AI runs.
- [x] Add original/proposed diffs, duplicate append/merge review, and connection provenance.
- [x] Add automation pause/budgets, usage reporting and content/trace controls.
- [x] Add URL clipper and bounded PDF extraction pilot with original preservation.
- [x] Simplify advanced visual controls and emphasize Board outcomes.
- [x] Consolidate capture lifecycle code and update architecture/docs to shipped behavior.
- [x] Pin runtimes, make optional services optional dependencies, patch dependency audit findings.
- [x] Add actual-backend browser workflows, perform release checks and record evidence.
- [ ] Consolidate finished branches without losing work; report any external release gates.

Each checkbox requires implementation and relevant verification. Subtasks use bounded sessions and targeted checks; complete suites run at integration milestones.

## Implemented behavior

- Editor drafts survive view changes, reload, and vault switches. Saved drafts retain the original content fingerprint. Save, rename, archive, merge, connection acceptance, and revision restore reject stale versions, including external Markdown edits that leave the frontmatter timestamp unchanged.
- Wikilinks share an ID/title/slug/path/alias contract, preserve heading navigation, and surface ambiguous matches. Navigation uses browser history and metadata-first loading; bodies are fetched on demand.
- Pending and rejected AI drafts remain in Inbox and out of ordinary notes, graph, and retrieval. Publication precedes Spider/Scribe. Failed finalization restores the source capture and reports the failure. The macOS watcher reconciles late atomic-save delete events against the current file.
- SQLite full-text search contributes candidates independently of vector search, applies filters before limits, and deduplicates at note level. Connector source IDs have a rebuildable, serialized SQLite lookup.
- Long captures use bounded chunks with explicit source coverage. The full original is accessible from a filed note. Oversized or unsuccessful processing stays reviewable.
- Today, project pins, Quick Capture, approved duplicate append/merge, original/proposed diffs, revision history, run undo, and graph connection evidence are available. Presentation tuning and Pulse sit under advanced controls; Board leads with outcomes.
- Automation controls pause background work, enforce per-source capture counts and estimated input-token allowances, report usage, and restrict cloud context by folder/tag. Raw trace content is disabled by default.
- URL and text-PDF ingestion preserve source bytes and provenance. Fetching is bounded, public-address-only, and redirect-validated; PDF extraction is isolated and has size/page/time limits.
- Shared capture lifecycle code now owns reservation, archive, rollback, and completion. Runtime pins/lockfiles, optional Redis/Postgres dependencies, current architecture documentation, and CI browser registration are included.

## Verification evidence — September 5, 2026

| Check | Result |
| --- | --- |
| Complete backend suite | 1,336 passed; one Starlette TestClient deprecation warning |
| Backend lint / formatting / mypy | Passed; 267 Python files formatted, 162 mypy source files |
| Complete frontend suite | 895 passed across 114 files under Node 22, including StrictMode draft recovery |
| Frontend lint / formatting / production build | Passed |
| Mocked critical browser flow + accessibility / provider failure | 2 passed |
| Actual FastAPI + filesystem browser lifecycle / provider failure | 2 passed; real API, watcher, filesystem, and UI with a fixture provider and temporary Loom home |
| Expanded capture evaluator | 10 cases passed; score 1.0 measures fixture orchestration, not live-model factual quality |
| Durable job / import rollback product drill | Passed: failed job retained, retry queued, malformed overwrite rolled back, export restored |
| Export/restore integrity drill | Passed; restored note SHA-256 matched |
| npm audit | 0 advisories, including development dependencies |
| pip dependency consistency | Passed |
| Docker Compose configuration | Passed |

The synthetic 1,000-note profile used 10 KiB bodies and actual in-process API calls. Metadata pages plus graph and one selected body transferred **584,532 bytes**, versus **10,756,913 bytes** for full bodies (94.6% less). Local elapsed time was **445.07 ms** versus **413.28 ms**; this establishes payload reduction, not a speed improvement. The reusable probe is `backend/scripts/metadata_profile.py`.

One initial profiling attempt incorrectly invoked normal application startup. It exited; its output does not establish whether background work ran. The corrected probe does not run startup services and uses a temporary vault. Subsequent startup-based checks explicitly isolate both Loom home environment names. No live provider calls were intentionally requested.

## Release limits and external gates

- Docker/OrbStack was not running. Compose validation passed, but a fresh container build and clean-volume smoke test remain unverified locally.
- Live Google/Microsoft/GitHub OAuth consent and real-provider quality/cost evaluation require account setup and explicit live evidence. Mocked adapters and fixture providers do not establish those outcomes.
- Local backend validation used Python 3.13; CI/Docker are pinned to 3.12. Hosted Linux/macOS/Windows and WSL release evidence remains a release gate.
- Token limits gate estimated input per attempt; output is counted afterward. Configured prices are operator estimates, not a hard spending cap or provider invoice.
- Revision history begins with writes made by this version. Revision and usage stores currently have no automatic pruning. Raw-trace controls do not retroactively erase older retained content.
- The clipper is a bounded first version: text PDFs only, no OCR or general office/image ingestion. Cloud exclusions apply to automatic vault context; text explicitly typed into chat is user-provided content.
- Public plugin ABI, hosted multi-user operation, and further themes remain deferred as recommended.

## Repository cleanup

Pending final integration commit and local branch consolidation. The existing PR #31 commits are ancestors of this work and will be retained. Remote PR #31 remains open and is not yet merged into `origin/main`; remote publication is separate from local implementation and cleanup.

# Loom project review — September 5, 2026

Loom has a strong foundation for a personal project-memory product. Plain Markdown, provider choice, inspectable agent runs, recoverable capture processing, and the Paper visual identity fit together well. The most valuable promise is that users can capture something quickly, trust how it is organized, and find it when they need it.

The next development cycle should concentrate on that promise. The project already has substantial infrastructure and customization; several everyday editing and linking behaviors need attention before feature scope grows further.

This review covers the repository at local `main` (`32def12`), the implementation and documentation across backend/frontend/storage/agents/connectors/deployment, the four main views in an isolated browser demo, automated checks, and the unmerged changes in PR #31 (`8d00307`). It is a broad engineering and product assessment, with focused reproductions of the findings below. Live provider quality, real-account OAuth, and a new Docker build were not exercised. No personal vault contents or credentials were used.

The strongest parts to preserve are:

- **Markdown ownership and archive-based recovery.** These give users a credible exit path and make the system understandable outside the UI.
- **Durable capture jobs and unified ingress.** Retry, cancellation, review, source identity, and recovery deserve to remain central architectural boundaries.
- **A clear separation between content-producing agents and vault-maintenance agents.** The provider layer also avoids coupling the application to one model vendor.
- **Traceability.** The Board's run/step inspector and source metadata are useful foundations for explaining AI changes.
- **Visual identity.** The Graph, reader, and Inbox feel like parts of the same application. Keep the Paper theme and readable typography.
- **Existing release discipline.** Type checking, restore drills, formatting, tests, health probes, and explicit release gates are valuable work already done.

The following issues should be addressed first. “Reproduced” means an observed browser action or a provider-free execution of the actual implementation in a temporary vault.

| Priority | Finding and evidence | Recommended change |
|---|---|---|
| P1 | **Unsaved editor text disappears when changing top-level views.** Reproduced: open Loom MVP, edit its body, choose Graph, then return to Thread. The original body returns and Save is disabled, with no discard prompt. Draft state is local to [ThreadView](/Users/mpawlowski/Documents/Projects/Loom/frontend/src/views/ThreadView.tsx:57), and [MainShell](/Users/mpawlowski/Documents/Projects/Loom/frontend/src/components/MainShell.tsx:187) unmounts it. The existing note-to-note guard does not protect this route. | Persist drafts by vault and note ID outside the view, retain the original version alongside the text, and guard tab changes, vault switches, reload, and close. Add a browser regression for this exact sequence. |
| P1 | **Canonical slug wikilinks can appear missing.** Reproduced in editor preview: `[[vault-structure]]` offers “Create note vault-structure,” while `[[Vault structure]]` opens the existing note. [The UI resolver](/Users/mpawlowski/Documents/Projects/Loom/frontend/src/context/useVaultContent.ts:220) only indexes titles, even though Weaver explicitly generates slug links. | Share one resolution contract across the reader, graph, agent context, and search: filename slug, title, alias, and heading fragment. Make duplicate-title ambiguity explicit. Test generated links against the actual reader. |
| P1 | **A rejected AI draft can appear as ordinary knowledge.** Reproduced: apply a failed Sentinel verdict, rebuild the note index and graph, and the rejected draft remains present with `status: active` and `review_required: true`. [Enforcement](/Users/mpawlowski/Documents/Projects/Loom/backend/agents/loom/enforcement.py:65) annotates it, while [NoteIndex](/Users/mpawlowski/Documents/Projects/Loom/backend/core/note_index.py:161) and the watcher do not exclude it. The frontend note conversion also omits review metadata. | Introduce an explicit draft/publication state. Keep pending/rejected content out of normal retrieval and the default graph, or make its review state visible wherever it is shown. Publish only after the configured acceptance policy succeeds. |
| P2 | **Nested-folder selection is silently ignored on the Weaver path.** Reproduced: `create_from_modal(..., folder="projects/atlas")` writes to `captures/`. The modal enumerates nested folders, but [Weaver's writer](/Users/mpawlowski/Documents/Projects/Loom/backend/agents/loom/weaver_io.py:87) treats any slash as suspicious. | Use the existing resolved-path containment boundary to accept valid nested destinations. Return an actionable error for an invalid destination instead of silently changing it. Verify both agent and fallback creation paths. |
| P2 | **The offline banner promises recovery that the client does not implement.** [MainShell](/Users/mpawlowski/Documents/Projects/Loom/frontend/src/components/MainShell.tsx:293) says changes will sync when the backend returns, while note saves make ordinary requests and report failure. | Change the copy to accurately explain unsaved changes immediately. Add durable draft storage before promising offline replay; any later outbox needs conflict handling and visible pending writes. |
| P2 | **Long captures are truncated before classification/generation.** [Weaver's helper](/Users/mpawlowski/Documents/Projects/Loom/backend/agents/loom/weaver_llm.py:108) only sends the first 2,000 source tokens for generation, with a 1,500-token classification cap. Original captures are retained, but information near the end may be omitted from the resulting note. | Show when input is shortened and use chunked processing or extraction for longer captures. Preserve the full original with an obvious source link. Add tests with essential facts at the end of the source. |

PR #31 also needs a targeted correction before merging. Its optional keychain implementation can generate a new encryption key after a completed migration when the keychain returns no entry. A temporary fake-keychain probe reproduced a fresh key write despite an existing migration marker; prior ciphertext could no longer be decrypted with the selected key. The branch's `backend/core/secrets.py`, line 116, must treat “migration marker exists, file key absent, keychain entry missing” as a recovery condition and refuse key generation. This finding applies to the unmerged branch, not the current `main` implementation. [PR #31](https://github.com/Mpawlowski5467/Loom/pull/31)

I would remove or simplify the following next. These are recommendations; source features were not deleted during the review.

| Change | Reason and scope |
|---|---|
| **Remove inaccurate product claims and stale status statements.** | Correct the offline-sync banner. `AGENTS.md` still describes a hand-rolled renderer, although the app uses `react-markdown`, and says onboarding requires a validated provider, although a skip flow exists. `docs/ARCHITECTURE.md` describes optional auto-git, but the reviewed implementation only exposes a config field. Document shipped, partial, and planned behavior consistently. |
| **Consolidate duplicated implementation summaries.** | README, AGENTS, the long architecture document, the condensed reference, roadmap, and readiness audit repeat state that has already drifted. Keep the roadmap authoritative for planned work, a concise current architecture, and dated evidence reports. Archive superseded planning material. |
| **Reduce the number of controls in the default experience.** | Keep the graph's useful exploration, filtering, and focus features. Move scene cycling, breathing/traveler tuning, and the Board's Pulse view into an advanced presentation area. New users should reach capture, review, and retrieval quickly. |
| **Move Redis/Postgres clients into optional installation extras.** | The single-container/local-file mode is the product's core. Compose already makes these services optional, but their clients are installed unconditionally. Retain them where there is a measured need for caching or trace mirroring. |
| **Retire overlapping capture execution paths gradually.** | The large capture router carries durable-job, direct-processing, preview, and commit paths. Put shared lifecycle transitions into a service and keep route handlers thin. Preserve compatibility until callers migrate. |
| **Defer a public plugin ABI, hosted multi-user operation, and more visual themes.** | Each expands the maintenance surface. Reliable editing, retrieval, and recovery offer more immediate user value. The six established themes already provide meaningful choice. |

Existing features worth updating, in priority order:

1. **Make search a reliable retrieval system.** The current [searcher](/Users/mpawlowski/Documents/Projects/Loom/backend/index/searcher.py:82) retrieves `limit × 4` vector chunks, then applies type/tag filters and keyword/graph boosts. A useful exact match outside that candidate pool never gets boosted, and filtering can discard most results. Combine full-text and vector candidate retrieval, filter during retrieval, rank/deduplicate at note level, and add an exact-title fast path. LanceDB already supports combining full-text and vector search, so this can build on the existing database. [LanceDB hybrid search documentation](https://docs.lancedb.com/search/hybrid-search)
2. **Load note metadata first and note bodies on demand.** [Every note refresh](/Users/mpawlowski/Documents/Projects/Loom/frontend/src/context/useVaultContent.ts:81) calls `loadAllNotes`; the client pages through all full note bodies. Use metadata and graph endpoints for navigation, fetch the open note separately, and apply changes by note ID. Profile a live API-backed vault with realistic body sizes, not only generated graph nodes.
3. **Index source IDs for connector ingestion.** [External-ID deduplication](/Users/mpawlowski/Documents/Projects/Loom/backend/core/capture_ingress.py:131) currently scans and parses Markdown across the whole vault, including archives, for each keyed capture. Replace this with a rebuildable per-vault lookup and uniqueness enforcement while retaining recovery from Markdown. This avoids repeated vault-wide work during large sync batches.
4. **Improve the Inbox's explanation of changes.** It already has preview/edit/accept and durable recovery. Add an original-versus-proposed diff, clearly separate suggested and applied links, expose the specific validation reason, and keep bulk actions consistent with single-item review.
5. **Evolve the reader into a dependable editor.** After fixing draft loss, add conflict resolution, wikilink completion, easier tag edits, working document/heading links, and a persistent way to browse other notes while reading. Browser back/forward and links to specific notes should restore navigation state.
6. **Make the Board lead with outcomes.** Show pending decisions, failed jobs, notes changed, and useful results before run counts and agent personalities. Keep raw traces one level deeper. Council chat should summarize work clearly and only expand individual agent contributions when useful.
7. **Measure real agent quality.** The fixture evaluator currently replays prepared responses for three cases. Its 1.0 score verifies orchestration and output handling; it does not establish live-model factual quality. Grow a versioned corpus with long notes, conflicting facts, duplicates, malformed content, prompt injection, custom folders, and provider failures. Track source fidelity, filing accuracy, useful links, review rate, latency, and cost separately.
8. **Add browser tests against the actual backend.** The current critical smoke test mocks API calls and files a seeded demo capture locally. Keep that fast UI check, then add a temporary-vault FastAPI test for create → review → file → edit → archive → restore, plus draft loss and provider failure. The unmerged PR adds a useful backend drill and wider mocked browser coverage; retain that work.
9. **Make developer setup reproducible.** CI and Docker use Node 22; this machine's default Node 26 caused 90 frontend test failures around localStorage. All 845 passed under Node 22. Add a runtime pin and `engines`, use reproducible installs, and align backend dev/CI dependency resolution with the tested runtime lock. Node's Web Storage behavior has changed across versions. [Node.js globals documentation](https://nodejs.org/api/globals.html#localstorage)
10. **Refresh dependency and release evidence.** Current npm audit reports one moderate, fixable development dependency advisory in `@humanfs/node`, with zero production advisories. Older “zero vulnerabilities” audit statements need dates. The monthly release workflow exists locally but is not yet available on `origin/main`; GitHub returns 404 for that workflow on the default branch. [Humanfs advisory](https://github.com/advisories/GHSA-p498-v437-472g)

The new features I would add are:

| Order | Feature | Useful first version |
|---|---|---|
| 1 | **Quick Capture from anywhere** | One keyboard shortcut and a small text/URL composer that saves immediately through unified ingress. Make it obvious from the Inbox. The current New Note flow can create a capture type, but asks for structure before the user has captured the thought. |
| 2 | **Version history and undo AI changes** | Store recoverable note revisions and show a diff. An “undo this run” operation should account for every note and link changed by that run, with conflict checks. Frontmatter action history and archive restore already exist; full content rollback is the added value. |
| 3 | **Duplicate-aware capture review** | Suggest “append to this existing note,” “merge,” or “create separately,” with evidence and user control. External-ID deduplication already handles repeated source items; this addresses overlapping meaning across different captures. |
| 4 | **A Today workspace** | Recent notes, pinned projects, captures awaiting review, failed jobs, and the latest Standup recap in one useful starting place. Let users choose this or Graph as their default. |
| 5 | **Explainable connections and answers** | Clicking an AI-created relationship should show its source excerpts, rationale, and whether a user accepted it. Researcher already has source-note evidence; extend that provenance to maintained links and edits. |
| 6 | **Automation budgets and content controls** | Per-source processing limits, cost/token accounting, an automation pause control, and rules for which notes can be sent to cloud providers or retained in raw traces. Existing retention and trace infrastructure provide a starting point. |
| 7 | **Small attachment/clipper pilot** | Start with a URL clipper and PDF text extraction, preserving the source URL/file and extraction provenance alongside Markdown. Broader office/image ingestion can follow after the core loop is reliable. |

Several apparent gaps are already being addressed in PR #31: GitHub device sign-in, deployment-managed Google connection setup, Moonshot/Kimi, optional keychain storage, graph-state extraction, progressive folder rendering, and expanded release drills. Evaluate and finish those changes before commissioning duplicate implementations. Google and Microsoft live-account validation still needs actual registration/consent evidence.

I would sequence the work into three milestones:

1. **Trust and release correctness:** repair draft loss, slug resolution, rejected-draft visibility, nested-folder routing, inaccurate offline copy, and the PR's keychain recovery case; add focused regressions; resolve the release branch deliberately.
2. **A faster daily workflow:** Quick Capture, metadata-first loading, improved search, indexed source deduplication, and a clearer review diff. Validate using real vaults and typical user tasks.
3. **Compounding value:** revision/undo, duplicate-aware merging, a Today workspace, and explainable links. Use observed demand to choose the next connector or attachment type.

Verification performed during this review:

| Check | Result |
|---|---|
| Backend tests | **1,247 passed**, one Starlette TestClient deprecation warning. The final run used an isolated Loom home. |
| Backend lint, formatting, mypy, dependency consistency | **Passed**; 233 formatted Python files, 142 mypy source files. |
| Frontend tests | **845 passed across 100 files under Node 22**. The first Node 26 run exposed a runtime compatibility issue. |
| Frontend lint, formatting, TypeScript/production build | **Passed**. |
| Playwright critical smoke + axe | **Passed**, one mocked/demo browser flow. |
| Capture fixture evaluator | **Passed**, 1.0 across three prepared-response cases. |
| Temporary vault export/restore drill | **Passed**, SHA-256 integrity verified. |
| npm dependency audit | **One moderate development advisory; zero production advisories**. |
| Docker Compose configuration | **Passed**. |
| New local Docker image build | **Not run**: Docker/OrbStack daemon unavailable. Existing PR CI shows a successful Docker image job for `8d00307`; that is separate evidence. |
| Live Google/Microsoft OAuth and live model behavior | **Not exercised**. |
| Targeted behavioral probes | Confirmed draft loss, slug resolution mismatch, nested-folder misfiling, rejected draft indexing/graph visibility, and the branch-only missing-keychain-entry case. |

Repository cleanup was handled conservatively. Remote references were refreshed with `git fetch --prune origin`. There are no extra branches fully merged into local `main`, no additional worktrees, and no stashes. The remaining branch, `codex/account-connections-and-release-hardening`, has four unique commits across 62 files and an open PR. It was preserved while the user's cleanup choice is pending. Local `main` is one commit ahead of `origin/main`; that commit is also an ancestor of the feature branch. No commits were discarded or published, no tags were removed, and no source features were deleted. This review document is the only new tracked-scope artifact.

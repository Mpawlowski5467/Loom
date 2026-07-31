# Release Readiness Audit

Audit date: **2026-07-30**  
Baseline: current worktree at commit `9dff41c`, including uncommitted connector
and agent-correctness work.

## Executive assessment

Loom is a credible open beta with unusually broad automated coverage. The
backend, frontend, type checker, production build, dependency audit, and Docker
image build all pass. It should not be tagged as the next release yet: the new
OAuth connectors have only mocked provider validation, the clean container's
readiness check conflicts with first-run onboarding, and frontend formatting is
not at a stable baseline. The audit fixed the stale UI version and fixed-port
OAuth callback instructions it found.

## Verification results

| Check | Result |
|---|---|
| `ruff check backend/` | Pass |
| `ruff format --check backend/` | Pass |
| `pytest -q` | Pass — 1,232 tests |
| `mypy api agents bridge core index` | Pass — 132 source files |
| `npm run lint` | Pass |
| `npm run test:run` | Pass — 837 tests across 98 files |
| `npm run build` | Pass, with bundle-size and dynamic-import warnings |
| `npm audit --omit=dev --audit-level=high` | Pass — 0 vulnerabilities |
| `python3 -m pip check` | Pass |
| `docker compose config --quiet` | Pass |
| `docker build -t loom:release-audit .` | Pass |
| Clean image root page | Pass — HTTP 200 |
| Clean image `/api/ready` | 503 before onboarding |
| `npm run format:check` | Fail — 81 frontend files reported |

The Python run emitted deprecation warnings from Starlette/httpx TestClient and
SlowAPI's use of `asyncio.iscoroutinefunction` under the local Python 3.14
runtime. They do not fail the supported Python 3.11+ application today, but
should be removed before they become upgrade blockers.

## Release blockers

1. Live-test Google and Microsoft OAuth end to end, including refresh,
   disconnect/reconnect, incremental cursors, and duplicate suppression.
2. Make Docker health represent process liveness during first-run onboarding;
   keep component readiness available separately for diagnostics.
3. Land a dedicated frontend formatting baseline and enforce it in CI.

## Fixed during this audit

- Splash and footer versions now come from `VITE_APP_VERSION`, matching the
  package and Settings → About.
- Google and Outlook callback instructions now follow the configured API origin,
  so alternate source-build ports display the registration URI users need.
- Current screenshots and the trailer were recaptured after those fixes.

## Important follow-up work

- Split the 1.05 MB minified frontend bundle; fix the ineffective
  `agentsRegistry` dynamic import.
- Expand Playwright beyond graph-focused coverage to the critical product loop.
- Add direct tests for the remaining graph hooks and Board child components.
- Exercise large vaults and virtualize the file tree before growth makes the
  left rail the primary interaction bottleneck.
- Decide whether the open-source support promise is macOS/Linux only or includes
  a regularly tested Windows/WSL path, then publish that matrix.
- Add an OS-keychain option for provider and connector secrets.

## What is already strong

- The capture path has durable SQLite jobs, retry/backoff/cancel/review,
  external-ID idempotency, and typed refresh events.
- Agent writes enforce read-before-write and route through traceable LangGraph
  runs without pulling in a second provider abstraction.
- Export/import and archival are bounded, locked, rollback-aware operations.
- The API remains loopback-oriented, documents its no-auth boundary, encrypts
  configured secrets at rest, and blocks DNS rebinding by default.
- The test volume is substantial on both sides of the stack, and the Docker
  production build is reproducible from the current worktree.

The prioritized plan is in [ROADMAP.md](ROADMAP.md).

# Release Readiness Audit

Audit date: **2026-08-16**
Baseline: `codex/account-connections-and-release-hardening`, including the
changes described in this audit.

## Executive assessment

Loom's automated release posture is substantially stronger and locally green.
The capture pipeline now has a versioned semantic quality gate; CI covers a
critical browser path and accessibility; Docker liveness is correct before
onboarding; backup, large-vault, security-posture, and cross-platform release
checks are repeatable rather than prose-only.

The release should not be tagged yet. Two evidence gates cannot be completed in
this local run: real Google/Microsoft OAuth requires user-owned app registrations
and consent, and the hosted Linux/macOS/Windows workflow has not yet run. The
local Dockerfile build also awaits a running Docker daemon; Compose validation
passes.

## Verification results

| Check | Result |
|---|---|
| `ruff check backend/` | Pass |
| `ruff format --check backend/` | Pass — 235 files |
| `mypy .` | Pass — 143 source files |
| `pytest -q` | Pass — 1,255 tests |
| deterministic semantic evaluation | Pass — 1.0 score, 0.9 gate |
| temporary multi-vault restore drill | Pass — SHA-256 integrity verified |
| 1k/5k/10k metadata + graph benchmark | Pass — 0.60s / 3.02s / 6.08s locally |
| `python -m pip check` | Pass |
| `npm run lint` | Pass |
| `npm run format:check` | Pass |
| `npm run test:run` | Pass — 848 tests across 100 files |
| `npm run build` | Pass — route chunks, no bundle warning |
| critical Playwright + axe smoke | Pass — 2 browser tests |
| full and production-only npm audit | Pass — 0 vulnerabilities |
| `docker compose config --quiet` | Pass |
| local Docker image build | Not run — Docker/OrbStack daemon unavailable |

The Python suite emits one Starlette deprecation warning: its TestClient/httpx
compatibility shim should move to `httpx2` before a future dependency upgrade
makes that warning an error.

## Remaining release gates

1. Follow [OAUTH-RELEASE-VALIDATION.md](OAUTH-RELEASE-VALIDATION.md) with real
   Google, Microsoft, and GitHub test accounts. Archive the live-probe and
   duplicate-suppression evidence.
2. Trigger `.github/workflows/release-matrix.yml` and record green Linux,
   macOS, Windows, and Linux-container jobs. Decide separately whether WSL is a
   supported surface and, if so, run its manual smoke pass.
3. Start Docker locally (or use the hosted matrix), build the image, and repeat
   the clean-volume product release drill.
4. Confirm the release version, changelog, screenshots/trailer, tag, and release
   notes only after those gates pass.

## Hardening completed in this audit

- `/api/live` is the container probe; `/api/ready` remains honest operational
  diagnostics.
- A versioned real-pipeline capture evaluator scores type, folder, title, tags,
  headings, wikilinks, and Sentinel verdict.
- Playwright covers onboarding, Inbox review, filing, Thread rename,
  archive/restore, an axe serious/critical scan, and a visible provider failure.
- Failed capture jobs expose recovery categories and recommended actions.
- Successful vault exports update a visible last-backup/reminder signal; a real
  temporary export/restore drill gates CI.
- Major frontend surfaces are code-split, custom-agent/Council state moved into
  tested hooks, and large vaults avoid eagerly rendering every note row.
- Settings diagnostics report allowed hosts, local/custom network scope,
  API-token state, encrypted secret-storage mode, and exposure warnings.
- Patched frontend tooling resolves the advisories discovered during this run.
- A manual/monthly three-OS workflow and a live OAuth validation CLI/runbook
  make external release evidence reproducible.

## Deliberate boundaries

- Secrets remain Fernet-encrypted with a machine-local key (or an externally
  supplied `LOOM_SECRET_KEY`). This is defense-in-depth, not OS-keychain storage.
- The API is a single-user localhost service. `LOOM_API_TOKEN` is a shared-token
  speed bump, not multi-user authentication; network exposure requires an
  authenticated TLS reverse proxy.
- Real-account OAuth, hosted OS runners, and Docker daemon execution are
  operational evidence, not conditions that can be mocked into completion.

The prioritized follow-up is in [ROADMAP.md](ROADMAP.md).

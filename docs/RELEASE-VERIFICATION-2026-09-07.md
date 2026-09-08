# Release verification — September 7, 2026

The implementation remains committed locally on `main` (`8d64bba`), with the
September 5 completion report in `ccbc75f`. This follow-up validates the pinned
backend runtime from a newly created environment. No commits were pushed and
no release was published during this check.

## Runtime and isolation

- macOS 26.5.1, Python 3.12.13, Node 22.23.1.
- Created a fresh temporary virtual environment and installed
  `backend/requirements.lock` plus `backend/requirements-dev.lock`, followed by
  the editable package with `--no-deps`. Dependency consistency passed.
- Tests, evaluation fixtures, and restore drills used temporary Loom homes.
  Browser tests set both `LOOM_HOME` and `LOOM_LOOM_HOME` before application
  startup and use a fixture provider. No live model calls were requested.
- A service was already using port 8000. It was left running; the browser fixture
  now uses loopback port **18076**, configurable through `LOOM_BROWSER_API_PORT`.
  The test still refuses to reuse an existing server.

## Results

| Check | Result |
| --- | --- |
| Full backend suite | **1,336 passed**, 35.21 seconds |
| Environment-alias tests with both home variables set | **4 passed** |
| Strict mypy | Passed, 162 source files |
| Ten-case fixture evaluator | Passed, 1.0 orchestration score; not a live-model quality result |
| Export/restore drill | Passed, restored note SHA-256 matched |
| Durable jobs and import rollback drill | Passed: failed job retained, retry queued, malformed import rolled back, exported capture restored |
| Actual-backend browser suite on Python 3.12 | **2 passed**, 21.8 seconds |
| Changed harness lint/format checks | Passed |
| Dependency consistency | Passed |

The browser flow covers capture preview/edit/file, title and body editing,
local draft recovery across Graph/Thread navigation and reload, archive,
restore, and reload. Its provider-failure scenario keeps the source reviewable.

The initial environment-alias test inherited the documented `LOOM_HOME`, which
correctly takes precedence over the legacy alias. The fallback test now unsets
the higher-priority variable explicitly. The complete suite passed with its
isolated legacy home setting, and the four alias tests also passed with both
variables initially present. This was a harness isolation issue, not a change
to configuration precedence.

## Reproduce the browser check

From `frontend`, after installing the locked backend and Node dependencies:

```bash
LOOM_BROWSER_PYTHON=/absolute/path/to/python3.12 npm run test:browser:backend
```

The frontend fixture uses port 4176 and the backend uses 18076. Set
`LOOM_BROWSER_API_PORT` to another available port if needed.

## Remaining external checks

- **Docker:** OrbStack is stopped. A new image build and disposable-container
  smoke test remain outstanding. The OrbStack CLI states that starting it
  resumes machines that were running when it was last stopped.
- **Hosted matrix:** GitHub currently exposes only the existing CI workflow.
  The release-matrix workflow and these commits must be published before the
  current Linux/macOS/Windows matrix can be dispatched.
- **Live OAuth:** Dedicated Google, Microsoft, and GitHub test registrations
  and account consent are still needed for the live validation runbook.
- **Live provider quality and WSL:** Neither was exercised by these local
  fixture-based checks.

These results add Python 3.12 evidence to the
[September 5 implementation report](IMPLEMENTATION-PROGRESS.md); they do not
claim completion of the remaining external release gates.

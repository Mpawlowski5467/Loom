# OAuth Release Validation

Google, Microsoft, and GitHub app registrations cannot be created or consented
by CI. This runbook turns that external requirement into a repeatable release
gate.

## Test accounts and callbacks

- Use dedicated test accounts with non-sensitive sample mail and calendars.
- Register the exact callback URLs shown in Settings → Connections. For the
  default local server they are:
  - `http://localhost:8000/api/automations/google/callback`
  - `http://localhost:8000/api/automations/calendar/outlook/callback`
- GitHub uses device authorization rather than a callback. Enable Device Flow
  on the GitHub App or OAuth App and set `LOOM_GITHUB_OAUTH_CLIENT_ID`.
- Configure at least one dedicated GitHub test repository in Loom. Grant only
  the read permissions needed for repository metadata, commits, issues, and
  pull requests.
- Keep the server on localhost. If a custom host is unavoidable, require TLS,
  edge authentication, and `LOOM_API_TOKEN`.

## Automated live probes

After connecting both accounts, run:

```bash
cd backend
.venv/bin/python scripts/validate_oauth_connectors.py
```

The probes call each provider, refresh an expired token when needed, and fail
unless Google Calendar, Gmail, Outlook Calendar, and every configured GitHub
test repository respond successfully.
To ingest each source twice and capture idempotency evidence:

```bash
.venv/bin/python scripts/validate_oauth_connectors.py --sync-twice \
  > oauth-validation.json
```

The sync mode writes real captures. On the second result for each endpoint,
confirm `created` is zero and previously seen items appear as `deduplicated`.
An item arriving between the two calls can legitimately create one new capture;
record that exception in the release evidence.

## Manual refresh and recovery matrix

Record the date, platform, Loom commit, test-account label, and JSON report.
Then verify all of the following for every connector:

- Disconnect in Settings and confirm tokens and incremental cursors are gone.
- Reconnect, run two syncs, and confirm duplicate-free Inbox ingestion.
- Revoke consent at the provider, confirm Loom shows a reconnect action, then
  reconnect successfully.
- Confirm OAuth authorization codes, refresh tokens, client secrets, and email
  bodies do not appear in API responses or normal application logs.

For Google and Microsoft specifically:

- Force the stored access token to expire in the test profile, rerun the probe,
  and confirm the refresh token is used without reconnecting.
- Select multiple calendars, including one empty calendar and one recurring
  event, and confirm per-calendar results are isolated.

For GitHub specifically:

- Complete the device flow from a fresh browser session and confirm Loom shows
  the connected GitHub username after approval.
- Exercise one public and one private test repository when possible. Confirm
  inaccessible repositories fail independently without blocking other repos.
- Confirm the GitHub App cannot write repository contents, comments, issues,
  pull requests, or workflow state.
- Confirm the one-time device code and access token do not appear in API
  responses after connection or in normal application logs.

This evidence is required before tagging a connector-bearing release. Mocked
tests remain the normal CI gate; they are not a substitute for this matrix.

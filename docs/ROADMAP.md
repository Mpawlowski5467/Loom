# Loom roadmap

This document is a plan, not a release record. For the implemented system, see
the [architecture reference](architecture-ref.md). Historical test counts and
audit findings remain in their dated reports; they are not rewritten here as
current evidence.

## Next release gates

The next beta should only be named and cut after these checks have current,
recorded evidence:

1. Create Google, Microsoft, and GitHub OAuth app registrations, connect
   dedicated test accounts, and complete the
   [OAuth validation runbook](OAUTH-RELEASE-VALIDATION.md). This must cover
   refresh, reconnect, cursor recovery, duplicate suppression, and
   multi-calendar behavior.
2. Run the hosted Linux, macOS, and Windows release matrix and keep its output
   with the release evidence. A Windows runner does not establish WSL support;
   perform a WSL smoke test before making that promise.
3. From a clean checkout and volume, complete a product drill: onboarding,
   import, capture review and filing, editor conflict recovery, archive and
   restore, export and restore, and one external connection.
4. Confirm one version across Python, JavaScript, API, UI, changelog, and tag.
   Refresh screenshots and release notes if the shipped interface changed.

## Reliability and performance

- Gather repeatable 5k/10k browser-profile data on representative hardware and
  tune budgets from observed results.
- Extend browser coverage for retry, backup download/import, connector
  reconnect, draft recovery, and version-conflicted merge/accept flows.
- Continue splitting the compatibility `AppContext` where a focused domain hook
  has a clearer lifecycle and test boundary.
- Tune Scribe and Sentinel using versioned, anonymized evaluation fixtures.
- Validate OS-keychain behavior on macOS, Windows, and a Linux Secret Service
  session, including encrypted-file fallback and migration.

## Later

- Define a versioned Bridge/plugin contract with permissions, secrets, rate
  limits, cursor ownership, and a stable capture shape.
- Consider a Prompt Compiler only after trace data identifies repeated context
  construction worth centralizing.
- Extend the shipped bounded URL/text-PDF pilot to images, OCR, office
  documents, and source files while retaining a Markdown anchor and recoverable original.
- Add authentication, TLS, and multi-user authorization only if Loom expands
  beyond its local, single-user boundary.

## Not planned for the next release

- Internet-hosted or general multi-user operation
- A stable third-party plugin ABI
- GitHub webhooks for a localhost-first deployment
- Non-Markdown files as first-class vault notes
- Mobile or hosted sync

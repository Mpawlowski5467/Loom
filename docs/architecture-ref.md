# Loom architecture reference

This is the concise, current description of Loom's implementation. It is the
authoritative architecture document for contributors and maintainers. The long
[architecture design reference](ARCHITECTURE.md) preserves earlier decisions;
the [roadmap](ROADMAP.md) and [vision](VISION.md) describe work that remains
planned. Dated reports are evidence from the time they were written, not a
current status statement.

## Runtime and boundaries

Loom is a local-first application: a React 19 and TypeScript client talks to a
FastAPI service on the same machine. Development and CI use **Python 3.12** and
**Node 22**. Docker builds the frontend and serves it with the API in one
container; the vault is persisted in the `loom-data` volume.

The API is intended for loopback use and does not provide multi-user
authentication. Provider credentials are encrypted at rest, but that is
defence in depth rather than an access-control boundary. A cloud provider only
receives content when the user configures it, subject to folder and tag
exclusions; Ollama can keep inference local.

## Vault and mutations

Each vault under `~/.loom/vaults/<name>/` is a Markdown filesystem. Notes have
YAML frontmatter with stable IDs, timestamps, type, tags, publication state,
and a history. Deletion archives a note under `threads/.archive/`; note writes,
archives, restores, and capture filing use path locks, optimistic content fingerprints, and
rollback-safe vault I/O.

The fixed note folders are `daily`, `projects`, `topics`, `people`, and
`captures`; vaults may add custom folders. `prime.md` is user-owned. Before an
agent mutates the vault it reads vault configuration, `prime.md`, its memory,
the relevant index, and related notes. Shuttle agents write only captures; Loom
agents can publish reviewed notes.

Revision history records mutations. The Thread view can inspect and restore a
version through a version-checked operation, so restoring a revision does not
silently replace a newer note. Pending and rejected capture drafts remain out
of normal note listings, graph construction, and retrieval until publication.

Vault export and import are disk-streamed and bounded: imports cap the archive
at 256 MiB compressed, 2 GiB expanded, and 50,000 members. Import stages an
overwrite and restores the prior vault if the swap fails. Capture originals are
archived only after filing succeeds, preserving their provenance for review.

## Loading, editing, and navigation

Vault lists load note metadata first. A selected note body is fetched on demand
and is marked `bodyLoaded` only after hydration, which keeps large-vault
navigation responsive without treating an empty metadata body as a real note.

The editor uses `react-markdown` with the project's wikilink handling for its
preview. It stores unsaved text in browser storage by **vault ID and note ID**,
including the original content fingerprint (with timestamp compatibility for older clients). A draft survives a Thread view
unmount, reload, and vault switch; it is never used to replace a newer body
silently. The editor makes discard explicit, warns if local persistence fails,
and retains version-conflicted text while offering compare, reload, or an
explicit overwrite. Tag edits and accessible wikilink completion use the same
version-checked note APIs.

Today is a user-selectable home alongside Graph. It gathers recent notes,
pinned projects, outstanding captures and jobs, and the latest Standup. Quick
Capture is available from the shell shortcut and sends text or a URL through
the shared capture ingress, so it has the same provenance, limits, and durable
job behavior as other capture sources.

## Search, graph, and links

The metadata index holds note summaries and supports the file tree, Today,
and fast navigation. LanceDB stores chunk embeddings. Search combines keyword
and semantic candidate ranks with reciprocal-rank fusion (RRF). Type/tag filters
apply during candidate retrieval, with an optional graph-context boost afterward. Without an embedding
provider, keyword retrieval remains available.

Wikilinks are canonicalized against note IDs, paths, aliases, and slugs. The
graph is derived from published notes and renders with Sigma.js. One graph
and renderer live for the whole view: adding or removing notes and links is
diffed onto them in place (`graph/graphSync.ts`), seeding new nodes beside
their neighbors and settling only those, so the camera and the rest of the
layout stay put; ForceAtlas2 runs only for a fresh build. Spider can
write deterministic link evidence: source and target identities, method/score,
bounded excerpts, timestamp/run/agent, and a state such as `suggested`,
`applied`, or `user_accepted`. Clicking a graph edge, using a neighbor's Evidence button, or opening Thread context exposes this evidence and its
explicitly labeled legacy fallback; a suggested relation is only accepted by a
version-checked, locked write.

## Captures and agents

All capture producers call `core.capture_ingress.ingest_capture`. It validates
provenance, deduplicates external sources, writes the capture, indexes it, and
creates a per-vault SQLite job. Inbox exposes active, review, failed, and
history states with retry and cancellation. Capture review can compare proposed
text, identify duplicate candidates using deterministic similarity evidence,
and perform an explicitly approved, version-checked merge.

The Loom layer contains Weaver, Spider, Archivist, Scribe, and Sentinel. The
Shuttle layer contains Researcher and Standup plus user-defined Shuttle agents.
The capture pipeline is a LangGraph state graph:

```
Weaver → Sentinel → enforce publication → Spider → Scribe
```

It retries a failed Sentinel draft once; only an accepted review state can
publish downstream work. Researcher and Standup have their own state graphs.
Council responses stream over SSE; their individual contributions can be
expanded while the summarized response remains the default view.

## Providers, policy, and trace data

Providers are behind one registry, with chat and embeddings selected
independently. Every model call records a trace with the provider, model,
request/response metadata, timing, caller, and run/step identity. Trace data
is visible in the Runs and raw-call views and mirrors to local storage with
retention; optional Redis and Postgres mirrors are bounded and degrade safely.
Treat trace content as sensitive because it can contain prompts and model
responses.

Automation policy controls source capture volume, pause state, and cloud
content exclusions. `daily_token_limit` is an **estimated input-token
allowance** reserved before a provider attempt. Generated output is accounted
afterward, so this setting is not a hard spending cap or a provider billing
guarantee.

## External sources and deployment

Calendar feeds, GitHub polling, read-only IMAP, Google Calendar/Gmail, and
Outlook Calendar all enter through the capture ingress. They preserve source
IDs and cursors for idempotency. Google and Outlook use encrypted refreshable
OAuth tokens, but their first real connection requires the operator to create
the corresponding OAuth app registration. Their code and mock coverage do not
substitute for that live validation.

Run `docker compose up` for the normal local installation. Before a release or
an externally configured deployment, complete the OAuth validation and the
release checks named in [ROADMAP.md](ROADMAP.md); this document does not claim
those gates have passed.

## Repository map

| Area | Location |
| --- | --- |
| FastAPI routers | `backend/api/routers/` |
| Vault, policy, jobs, and events | `backend/core/` |
| Loom and Shuttle agents | `backend/agents/` |
| Indexing and retrieval | `backend/index/` |
| React views and components | `frontend/src/views/`, `frontend/src/components/` |
| Markdown preview and editor helpers | `frontend/src/editor/` |
| Browser/API clients | `frontend/src/api/` |

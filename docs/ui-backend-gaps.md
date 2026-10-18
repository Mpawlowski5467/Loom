# UI ↔ backend gaps

The shadcn/ui frontend rebuild (branches `feat/ui-*`) is designed against a
handful of endpoints and data the backend doesn't have yet. This file lists
each gap: what's missing, what the UI does today without it, and the
smallest backend change that would close it.

No backend route has been added for the rebuild. Each missing endpoint has a
typed client in `frontend/src/api/` with a mock adapter in
`frontend/src/api/mocks/`. Set `VITE_LOOM_MOCKS=1` to serve those mocks from
in-memory fixtures (fictional data only) while every existing endpoint keeps
going to the real backend.

Status key: **mocked** = typed client and mock exist; **derived** = the UI
approximates it from existing endpoints; **planned** = needed by a later
rebuild phase, no client yet.

## Summary

| # | Gap | Needed by | Status |
|---|---|---|---|
| 1 | Appearance settings per vault | Settings → Appearance | mocked |
| 2 | Supersession fields and search filter | Notes, Graph, Palette, Threads | UI reads frontmatter; demo seed only (roadmap 3) |
| 3 | Graph communities | Graph, Palette, Inbox, Threads | derived (client Louvain; roadmap 6) |
| 4 | Search score breakdown and timing | Palette | planned |
| 5 | Related notes for a note | Notes context rail | mocked; derived from search |
| 6 | Dismiss a Spider link suggestion | Notes | mocked; remembered locally |
| 7 | Weaver drafts a section | Notes slash menu | mocked |
| 8 | Persisted Archivist findings per note | Graph note panel | mocked; superseded warning derived |
| 9 | Agent stats and scheduled/watching states | Board | planned (derived where possible) |
| 10 | Council with note context, proposed changes | Notes, Board | planned (Ask Council prefills the composer) |
| 11 | Stored capture proposals with a Sentinel pre-check | Inbox | planned |
| 12 | Structured daily summary | Threads | planned (derived from changelog) |
| 13 | Vault stats and actions per day | Threads | planned (derived) |
| 14 | Per-note agent activity feed | Notes | derived |
| 15 | Theme names in the config enum | Onboarding | workaround in place |

## 1. Appearance settings per vault

**Missing:** `GET /api/settings/appearance` and `PUT /api/settings/appearance`,
stored in the active vault at `config/appearance.yaml`.

**Shape** (`frontend/src/theme/appearance.ts`, `AppearanceSettings`):

```yaml
theme: graphite            # graphite | paper | midnight | forest | linen | high-contrast
followSystem: false
darkTheme: graphite        # a dark theme: graphite | midnight | forest | high-contrast
lightTheme: paper          # a light theme: paper | linen
brandOverride: null        # null or "#3b82f6" | "#14b8a6" | "#f59e0b" | "#8b5cf6" | "#f43f5e"
editorFont: geist          # geist | mono | serif
graphPalette: theme        # theme | colorblind
textSize: md               # sm | md | lg
density: cozy              # compact | cozy | comfortable
motion: auto               # auto | on | off
```

`GET` returns the object, or `null` when the vault has none saved yet; `PUT`
takes and returns the full object. The client normalises any invalid field
to its default, so the server can be lenient.

**Today:** the client (`frontend/src/api/appearance.ts`) treats a 404/405 as
"unsupported" and keeps settings in localStorage only; Settings says
"Saved on this device". `ThemeProvider` re-reads the settings when the active
vault changes.

**Backend notes:**

- `core/vault_io` only allows `threads/**.md` writes, so this needs a small
  dedicated writer (as `agents.yaml` has).
- Decide whether `config/` is committed to vault history. It probably should
  be, as `Agent: human`.
- The `vault.yaml` / `VaultConfig` model has no UI fields today.

## 2. Supersession

**Missing:** a way for a note to supersede another. Roadmap item 3 plans
`status: superseded` plus supersession links. The UI will read:

- `status: superseded` on the old note;
- `supersedes: [[old-note]]` and optionally `valid_from: <date>` on the new
  note;
- `superseded_by: [[new-note]]` on the old note (optional; can be derived);
- `GET /api/search?...&include_superseded=true` (default false).

**Used by:** the Notes supersession banner and struck-through tree rows; the
Graph "Superseded" toggle; the palette's "Superseded hidden · ⌥S"; muted
Related matches; the Threads "superseded" stat; the Archivist warning card.

**Today:** nothing writes these fields, so the UI features stay dormant on
real vaults and are exercised through mocks.

## 3. Graph communities

**Missing:** per-node community ids and labels (roadmap item 6).
`GET /api/graph` nodes carry `id, title, type, tags, link_count` only.

**Today:** the UI computes communities in the browser with
`graphology-communities-louvain` (`frontend/src/graph/communities.ts`, seeded,
so it's deterministic), recomputed only when notes or links change. The four
largest communities get `--community-1..4`; the rest are drawn in a neutral
tone, and each is named after its most-linked note. The backend version
should return `community: <id>` per node plus
`communities: [{id, label, size}]`, so the colouring is stable across
clients.

## 4. Search score breakdown and timing

**Missing:**

- Per-result `match: { keyword?: {rank, score}, semantic?: {chunk, heading,
  score}, graph?: {boost} }`.
- A response-level `took_ms`.

`score` is currently an RRF fusion with the graph and keyword boosts folded
in (`index/searcher.py`).

**Today:** the palette shows the response `mode` (semantic/keyword) and
times the request on the client. Its "Why it matched" panel is mocked.

## 5. Related notes

**Missing:** `GET /api/notes/{id}/related?limit=` returning hybrid matches
`[{note_id, title, score, superseded}]` without side effects.

**Today:** approximated with `GET /api/search?q=<title>&context=<id>`
(labelled as approximate). `POST /api/agents/spider/scan` is not used here
because it writes links.

## 6. Dismiss a Spider suggestion

**Missing:** `POST /api/connections/dismiss {source_id, target_id}`. It should
mark the `link_evidence` entry `state: dismissed` so later scans don't
re-suggest it. This relates to the roadmap follow-up "make an undone Spider
link stick".

**Today:** Link works through `POST /api/connections/accept`. Dismiss calls
`dismissConnection`; when the backend can't record it, the dismissal is kept
in browser storage (`loom:dismissed-links:v1:<vault>`) so the card stays
hidden on this device.

## 7. Weaver drafts a section

**Missing:** `POST /api/agents/weaver/draft {note_id, heading, instruction}`
→ `{markdown, trace_id}`, read-only (the editor inserts the text and the
normal save path writes it).

**Today:** the slash-menu item calls `draftSection` (`frontend/src/api/weaver.ts`). It's mocked under `VITE_LOOM_MOCKS`; without mocks the backend's 404 shows "Drafting with Weaver needs a backend endpoint that doesn't exist yet."

## 8. Archivist findings per note

**Missing:** persisted audit results, e.g.
`GET /api/notes/{id}/findings` → `[{agent: "archivist", kind, message,
created}]`. Archivist issues are currently only returned by
`POST /api/agents/archivist/run`.

**Today:** the Graph note panel's Archivist card shows two things. "Superseded
by …" is derived from frontmatter (§2). Findings come from `getNoteFindings`
(`frontend/src/api/findings.ts`), which is mocked under `VITE_LOOM_MOCKS` with
stale/orphan findings derived from the note itself. Without mocks a 404 means
"no findings", so the card only appears for superseded notes.

## 9. Agent stats and states

**Missing:**

- `GET /api/agents/stats` → `{actions_today, sentinel: {passed, warning,
  failed}, open_flags, next_runs: [{agent, at}]}`.
- `scheduled` and `watching` states in `GET /api/agents/activity` (only
  `running`/`idle` exist).

**Today:** these are derived on the client.

- Actions today and the pass rate come from `GET /api/changelog/feed`, a
  7-day window capped at 200 rows.
- Open flags come from `extra.flagged` on the loaded notes and captures.
- The next run comes from `GET /api/automations/standup` (Standup only).

Weaver and Sentinel have no standalone run endpoint (they're pipeline
stages), so their "Run now" is disabled.

## 10. Council

**Missing:**

- A `context_note_id` on `POST /api/chat/send/stream` so "Ask Council" from a
  note grounds the discussion.
- Council-proposed changes. The Council never writes, so the spec's Summary
  card "Open diff / Undo" has nothing to act on.

**Today:** the Council summary renders without diff/undo, and those buttons
appear only for mocked responses that carry commit refs.

## 11. Capture proposals

**Missing:**

- A stored Weaver proposal per capture, so the list can show "Proposal ready"
  without running the LLM.
- A Sentinel pre-check in it. `POST /api/captures/preview` is an on-demand LLM
  dry run with no Sentinel step.

**Today:** previews load lazily on selection and are cached per capture for
the session, and the pre-check list is mocked. MCP and Telegram sources
(roadmap items 5 and 7) don't exist; source badges map the real `source`
strings (`manual:clipper` → Web clip, `bridge:email`/`bridge:gmail` → Email,
and so on).

## 12. Structured daily summary

**Missing:** `GET /api/threads/daily/{date}` → `{new_notes: [...], flags:
[...], links: [...], written_by, written_at}`. Scribe's daily log is
free-form markdown today.

**Today:** the Threads day view derives rows from the changelog feed for that
date and renders the daily note's markdown.

## 13. Vault stats and actions per day

**Missing:** `GET /api/stats/vault` → `{notes, links, superseded,
undone_by_user, actions_per_day: [{date, count}]}`.

**Today:** derived from `/api/index/stats`, the graph's edges, and the
changelog feed (`reverted`). Superseded stays 0 until gap 2 closes.

## 14. Per-note agent activity

**Missing:** `GET /api/notes/{id}/activity` merging the frontmatter
`history[]`, git history and revisions into one timeline.

**Today:** the Notes rail merges frontmatter `history[]` with
`GET /api/history?path=` on the client.

## 15. Theme names in the backend config

`core/config.py`'s `ThemeName` enum lists the old themes (paper, porcelain,
herbarium, midnight, lagoon, ember), and onboarding's `/complete` requires
one. Until it accepts the new ids (or drops `theme` in favour of gap 1),
onboarding sends the nearest old name (`frontend/src/theme/backendTheme.ts`)
and the UI no longer PATCHes `/api/config` with a theme.

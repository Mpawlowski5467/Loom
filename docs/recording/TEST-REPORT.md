# Loom — Live End-to-End Test Report

**Date:** 2026-07-18 (early morning UTC) · **Branch under test:** `main` @ `0668f3f` (includes PR #20)
**Environment:** backend on `:8100`, frontend dev server on `:5173`, scratch `LOOM_HOME=/tmp/loom-rec` (demo vault, 22 seeded notes), provider: **local Ollama** (`phi4` chat, `nomic-embed-text` embed) — zero cloud keys involved.

**Videos:** [`loom-live-test.mp4`](./loom-live-test.mp4) (4:50, all segments) · [seg1 graph](./seg1-graph.mp4) · [seg2 thread](./seg2-thread.mp4) · [seg3 inbox](./seg3-inbox.mp4) · [seg4 board+council](./seg4-board.mp4) · [seg5 settings](./seg5-settings.mp4)

**Capture method (honest note):** the session was driven with Playwright (Chromium) and recorded via Playwright's page-level video, not OS screen capture — the machine's console locked mid-session (3 AM), making OS-level recording show only wallpaper. Page-level capture is identical on-screen content, minus the desktop. OS-level permission and a 2 s clip were verified working before the switch.

---

## What was exercised, and what happened

| # | Area | Actions on camera | Result |
|---|------|-------------------|--------|
| 1 | **GraphView** | cold load, hover/lens wander, display panel, cycled Rings→Spiral→Arms→Galaxy→Wave→Force, node click | ✅ All five orbit scenes render and transition; force layout settles; "18 nodes · 29 edges" stats; indexing status banner honest ("1 note not yet indexed — rebuilding search…") |
| 2 | **ThreadView** | tree → open note, scroll, context/outline sidebar, edit → append line → save, ⌘K palette → jump to note | ✅ Edit+save round-trip verified on disk (`atlas-mapping-engine.md` contains the appended line); outline sidebar opens; ⌘K search jumps correctly |
| 3 | **InboxView** | select capture → detail preview → Queue → Jobs lane state watch | ⚠️ Queue→RUNNING visible and durable; this job **stranded** (see Finding 1). In a same-day dry run, the GeoTech capture went Queue→archived in ~16 s and the retro capture went to **needs_review** in 69 s with Sentinel's verdict attached — the fail-closed path works |
| 4 | **BoardView + Council** | cards/pulse toggle, per-agent cards, council question "What does this vault know about WebGPU?" | ✅ Agent cards show live states (weaver SETTLING, spider RUNNING…); council streamed a grounded multi-paragraph answer citing vault content; answer persisted to `agents/_council/chat/2026-07-18.md` |
| 5 | **Settings** | ⌘; → Appearance: Midnight Ink→Herbarium→Lagoon→Paper (each verified applied), Providers, About | ✅ All six theme cards work; providers show Ollama chat+embed; diagnostics render; theme persisted to `config.yaml` |

## Backend behavior verified off-camera

- `/api/ready` transitions: 503 pre-vault → component-level readiness → `ok:true` after provider config + reindex (51 chunks embedded via Ollama).
- **Crash recovery**: SIGTERM mid-pipeline → startup recovery reclaimed the job (`attempts=1`, "Interrupted by process restart") — but see Finding 1.
- **Sentinel-retry loop**: Weaver draft → Sentinel fail → draft archived "Superseded by Sentinel-retry regeneration" → one regeneration → `needs_review` with reasons. Frontmatter history documents every transition exactly as designed.
- Provider config hot-swap (gpt-oss:20b → phi4) via `POST /api/settings/providers` rebuilt agents live, no restart.

## Findings from the live session

### 1. ⚠️ Jobs can strand in `running` indefinitely (filed as issue)
Two independent occurrences in one evening: (a) after SIGTERM mid-run, (b) spontaneous — the WebGPU job shows RUNNING in the Jobs lane with **zero LLM activity for 30+ minutes** (last pipeline trace 08:15 UTC, still "running" at 08:46). `cancel` rejects it ("only queued or retrying"), `retry` rejects it ("only terminal failed, review, or cancelled"), and with `capture_processing.mode: manual` nothing ever advances it. The UI shows an eternal spinner with no affordance. Likely a client-disconnect mid-`/process` stranding the reservation. Needs a stale-job watchdog (heartbeat/timeout → requeue or terminal-fail) or, minimally, allowing cancel/retry on stale running jobs. **Filed as a GitHub issue with full evidence.**

### 2. ℹ️ Reasoning models make the pipeline impractical for interactive use
`gpt-oss:20b` exceeded 5 min for a single capture (thinking tokens × 4+ pipeline calls). `phi4` brought it to 16–69 s. Worth a docs note: recommend non-reasoning chat models for the capture pipeline.

### 3. ✅ No UI regressions observed
The PR #20/#21 changes (notesError state, memoized graph keys, debounced persistence, ThreadView memoization) were all exercised live — slider drags, tab churn, edit/save, selection changes — with no visible jank or misbehavior.

## Session artifacts

- Combined video: `docs/recording/loom-live-test.mp4` (4:50)
- Per-segment videos: `docs/recording/seg*.mp4`
- Automation scripts: preserved at `/tmp/loom-rec/rec/*.mjs` (Playwright; can re-run any segment)
- Demo vault: `/tmp/loom-rec/vaults/default` (scratch; safe to delete)

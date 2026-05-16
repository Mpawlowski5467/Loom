import type { CouncilMessage } from "./types";

export const councilSeed: CouncilMessage[] = [
  {
    id: "cm_001",
    who: "you",
    body: "what's the state of my vault?",
    at: "2026-05-16T09:30:00Z",
  },
  {
    id: "cm_002",
    who: "agent:weaver",
    body: "I created [[Paper theme]] from a capture you dropped this morning. It's in captures/ — waiting on your accept.",
    at: "2026-05-16T09:30:08Z",
  },
  {
    id: "cm_003",
    who: "agent:spider",
    body: "Linked [[Webhooks]] → [[Webhook retries]] (high confidence). Two weak links to [[Caching]] flagged for review.",
    at: "2026-05-16T09:30:14Z",
  },
  {
    id: "cm_004",
    who: "agent:sentinel",
    body: "All 3 edits today validated clean. One duplicate-title warning on [[Markdown]] — looks like a near-miss, not a collision.",
    at: "2026-05-16T09:30:22Z",
  },
  {
    id: "cm_005",
    who: "agent:scribe",
    body: "Summary queue: 2 notes over the 800-word threshold. Want me to summarize?",
    at: "2026-05-16T09:30:31Z",
  },
  {
    id: "cm_006",
    who: "agent:archivist",
    body: "Nothing to archive. The captures pile has 5 unprocessed items — should I escalate to weaver?",
    at: "2026-05-16T09:30:37Z",
  },
  {
    id: "cm_007",
    who: "summary",
    body: "Vault is healthy. 1 capture for your accept ([[Paper theme]]); 2 summaries queued; 5 raw captures pending weaver.",
    at: "2026-05-16T09:30:50Z",
  },
];

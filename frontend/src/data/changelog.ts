import type { AgentEvent } from "./types";

export const changelogSeed: AgentEvent[] = [
  {
    id: "ev_001",
    ts: "09:42:14",
    agent: "weaver",
    action: "filed",
    target: "[[Paper theme]] → captures/",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_002",
    ts: "09:40:02",
    agent: "spider",
    action: "linked",
    target: "[[Webhooks]] → [[Webhook retries]]",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_003",
    ts: "09:38:21",
    agent: "sentinel",
    action: "validated",
    target: "edit on [[Caching]]",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_004",
    ts: "09:35:55",
    agent: "researcher",
    action: "synthesized",
    target: "capture: 'Sigma 3 nodeReducer'",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_005",
    ts: "09:32:10",
    agent: "scribe",
    action: "summarized",
    target: "[[Caching]] (228 words)",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_006",
    ts: "09:28:44",
    agent: "spider",
    action: "linked",
    target: "[[Markdown]] → [[Wikilinks]]",
    chain: "ok",
    sentinel: "warn",
  },
  {
    id: "ev_007",
    ts: "09:25:01",
    agent: "archivist",
    action: "archived",
    target: "stale capture from 2026-04-12",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_008",
    ts: "09:18:30",
    agent: "standup",
    action: "wrote",
    target: "[[2026-05-16]]",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_009",
    ts: "09:15:12",
    agent: "sentinel",
    action: "validated",
    target: "edit on [[Loom MVP]]",
    chain: "ok",
    sentinel: "ok",
  },
  {
    id: "ev_010",
    ts: "09:10:48",
    agent: "weaver",
    action: "filed",
    target: "[[Standup notes]] → daily/",
    chain: "ok",
    sentinel: "ok",
  },
];

const SCRIPTED_EVENTS: Omit<AgentEvent, "id" | "ts">[] = [
  {
    agent: "spider",
    action: "linked",
    target: "[[Embeddings]] → [[Provider matrix]]",
    chain: "ok",
    sentinel: "ok",
  },
  {
    agent: "scribe",
    action: "summarized",
    target: "[[Loom MVP]] (164 words)",
    chain: "ok",
    sentinel: "ok",
  },
  {
    agent: "sentinel",
    action: "validated",
    target: "edit on [[Wikilinks]]",
    chain: "ok",
    sentinel: "ok",
  },
  {
    agent: "weaver",
    action: "filed",
    target: "capture → [[Graph layouts]]",
    chain: "ok",
    sentinel: "ok",
  },
  {
    agent: "spider",
    action: "flagged",
    target: "weak link [[Caching]] ↔ [[Markdown]]",
    chain: "ok",
    sentinel: "warn",
  },
  {
    agent: "archivist",
    action: "moved",
    target: "[[Workshop ideas]] → scratch/",
    chain: "ok",
    sentinel: "ok",
  },
  {
    agent: "researcher",
    action: "drafted",
    target: "capture on LanceDB chunking",
    chain: "ok",
    sentinel: "ok",
  },
  {
    agent: "sentinel",
    action: "blocked",
    target: "duplicate title attempt on [[Markdown]]",
    chain: "fail",
    sentinel: "fail",
  },
];

export function nextScriptedEvent(seq: number): Omit<AgentEvent, "id" | "ts"> {
  return SCRIPTED_EVENTS[seq % SCRIPTED_EVENTS.length]!;
}

export function nowHMS(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

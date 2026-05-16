export interface ActivityEntry {
  time: string;
  agent: string;
  action: string;
  details: string;
}

export type ShuttleTab = "researcher" | "standup";

export const LOOM_NAMES = new Set([
  "weaver",
  "spider",
  "archivist",
  "scribe",
  "sentinel",
]);

export const SHUTTLE_TABS: readonly ShuttleTab[] = ["researcher", "standup"] as const;

export const ALL_AGENT_NAMES: readonly string[] = [
  "weaver",
  "spider",
  "archivist",
  "scribe",
  "sentinel",
  "researcher",
  "standup",
] as const;

export const POLL_MS = 5_000;
export const SKELETON_LOOM_COUNT = 5;
export const SKELETON_SHUTTLE_COUNT = 2;

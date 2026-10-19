import type { AgentEvent } from "../data/types";
import { apiClient } from "./client";

export interface ChangelogFeedEvent {
  id: string;
  ts: string;
  agent: string;
  action: string;
  target: string;
  chain: "ok" | "warn" | "fail";
  sentinel: "ok" | "warn" | "fail";
  /** Vault-history commit this action produced, when there is one. */
  commit?: string | null;
  /** That commit has since been undone. */
  reverted?: boolean;
}

export function fetchChangelogFeed(
  limit: number = 40,
  signal?: AbortSignal,
): Promise<ChangelogFeedEvent[]> {
  return apiClient.get<ChangelogFeedEvent[]>(
    `/api/changelog/feed?limit=${limit}`,
    signal,
  );
}

/** A feed row as the Board's AgentEvent (chain "warn" counts as "fail"). */
export function toAgentEvent(e: ChangelogFeedEvent): AgentEvent {
  return {
    id: e.id,
    ts: e.ts,
    agent: e.agent,
    action: e.action,
    target: e.target,
    chain: e.chain === "ok" ? "ok" : "fail",
    sentinel: e.sentinel,
    commit: e.commit ?? null,
    reverted: e.reverted ?? false,
  };
}

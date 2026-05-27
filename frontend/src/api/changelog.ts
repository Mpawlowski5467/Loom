import { apiClient } from "./client";

export interface ChangelogFeedEvent {
  id: string;
  ts: string;
  agent: string;
  action: string;
  target: string;
  chain: "ok" | "warn" | "fail";
  sentinel: "ok" | "warn" | "fail";
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

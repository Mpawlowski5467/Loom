import { apiClient } from "./client";

/** One git commit in the vault history. */
export interface HistoryEntry {
  sha: string;
  short_sha: string;
  subject: string;
  author: string;
  date: string;
  agents: string[];
  action: string;
  reason: string;
  sentinel: string;
  run_id: string;
  group: string;
  reverts: string;
  files: string[];
  revertible: boolean;
}

export interface HistoryFileDiff {
  path: string;
  status: string;
  before: string | null;
  after: string | null;
  truncated: boolean;
}

export interface HistoryDiff extends HistoryEntry {
  file_diffs: HistoryFileDiff[];
  files_truncated: boolean;
  patch: string;
  patch_truncated: boolean;
}

export interface HistoryStatus {
  enabled: boolean;
  reason: string;
  head?: string | null;
  pending?: number;
  human_debounce_seconds?: number;
  last_error?: string;
}

export interface RevertResult {
  status: string;
  reverted: string;
  sha: string | null;
  files: string[];
  sentinel: { status: string; reasons: string[] };
}

export interface HistoryFilter {
  path?: string;
  agent?: string;
  group?: string;
  limit?: number;
}

/** Vault-relative path of a note in the history repo, e.g. ``threads/topics/raft.md``. */
export function notePath(folder: string, filename: string): string {
  return ["threads", folder, filename].filter(Boolean).join("/");
}

export const getHistoryStatus = () =>
  apiClient.get<HistoryStatus>("/api/history/status");

export function listHistory(filter: HistoryFilter = {}) {
  const params = new URLSearchParams();
  if (filter.path) params.set("path", filter.path);
  if (filter.agent) params.set("agent", filter.agent);
  if (filter.group) params.set("group", filter.group);
  if (filter.limit) params.set("limit", String(filter.limit));
  const query = params.toString();
  return apiClient.get<HistoryEntry[]>(
    `/api/history${query ? `?${query}` : ""}`,
  );
}

export const getCommitDiff = (sha: string) =>
  apiClient.get<HistoryDiff>(`/api/history/${encodeURIComponent(sha)}/diff`);

export const revertCommit = (sha: string) =>
  apiClient.post<RevertResult>(
    `/api/history/${encodeURIComponent(sha)}/revert`,
    {},
  );

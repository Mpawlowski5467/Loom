import { request } from "./common";

export interface IndexStatus {
  ready: boolean;
  message: string;
}

export interface ReindexResult {
  chunks_indexed: number;
}

export function fetchIndexStatus(): Promise<IndexStatus> {
  return request<IndexStatus>("/api/index/status");
}

export function reindexVault(): Promise<ReindexResult> {
  return request<ReindexResult>("/api/index/reindex", { method: "POST" });
}

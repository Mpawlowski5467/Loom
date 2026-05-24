import type { Note, NodeType } from "../data/types";
import { apiClient } from "./client";

export interface SearchResult {
  note_id: string;
  title: string;
  heading: string;
  snippet: string;
  score: number;
  type: NodeType;
}

interface BackendSearchHit {
  id: string;
  title: string;
  type: string;
  tags: string[];
  snippet: string;
  score: number;
  heading: string;
}

interface BackendSearchResponse {
  query: string;
  results: BackendSearchHit[];
  mode: "semantic" | "keyword";
}

const NODE_TYPES: ReadonlySet<NodeType> = new Set([
  "project",
  "topic",
  "people",
  "daily",
  "capture",
  "custom",
]);

function narrowType(t: string): NodeType {
  return (NODE_TYPES as Set<string>).has(t) ? (t as NodeType) : "custom";
}

export async function searchNotesRemote(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const resp = await apiClient.get<BackendSearchResponse>(
    `/api/search?${params.toString()}`,
    signal,
  );
  return resp.results.slice(0, limit).map((hit) => ({
    note_id: hit.id,
    title: hit.title,
    heading: hit.heading,
    snippet: hit.snippet,
    score: hit.score,
    type: narrowType(hit.type),
  }));
}

function snippetFor(body: string): string {
  return body.replace(/\n+/g, " ").slice(0, 110);
}

function firstHeading(body: string): string {
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) return line.slice(3).trim();
  }
  return "";
}

export function recentNotes(notes: Note[], limit = 8): SearchResult[] {
  return notes
    .slice()
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, limit)
    .map((n) => ({
      note_id: n.id,
      title: n.title,
      heading: firstHeading(n.body),
      snippet: snippetFor(n.body),
      score: 0,
      type: n.type,
    }));
}

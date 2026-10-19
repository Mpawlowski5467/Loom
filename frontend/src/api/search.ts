import type { Note, NodeType } from "../data/types";
import { apiClient } from "./client";
import { MOCKS_ENABLED } from "./mocks";
import { withMockScoring } from "./mocks/search";

export interface SearchResult {
  note_id: string;
  title: string;
  heading: string;
  snippet: string;
  score: number;
  type: NodeType;
}

export interface BackendSearchHit {
  id: string;
  title: string;
  type: string;
  tags: string[];
  snippet: string;
  score: number;
  heading: string;
}

export interface BackendSearchResponse {
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
  /** Note id whose linked notes the backend boosts (graph context). */
  context?: string,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (context) params.set("context", context);
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

/**
 * Why a hit matched, per retrieval signal. BACKEND GAP
 * (docs/ui-backend-gaps.md §4): `/api/search` fuses these into one score and
 * doesn't report them yet; mocked with VITE_LOOM_MOCKS.
 */
export interface MatchBreakdown {
  keyword?: { rank: number; score: number };
  semantic?: { chunk: string; heading: string; score: number };
  graph?: { boost: number };
}

export interface VaultSearchHit {
  noteId: string;
  title: string;
  type: NodeType;
  tags: string[];
  snippet: string;
  heading: string;
  score: number;
  /** null until the backend reports per-signal scores (gap §4). */
  match: MatchBreakdown | null;
}

export interface VaultSearch {
  query: string;
  hits: VaultSearchHit[];
  /** "hybrid" = keyword + semantic ranks fused; "keyword" = no embeddings. */
  mode: "hybrid" | "keyword";
  tookMs: number;
  /** Whether tookMs came from the server or was timed in the browser. */
  timing: "server" | "client";
  /** Matched in the browser because the search API was unreachable. */
  offline?: boolean;
}

export interface VaultSearchOptions {
  /** Note whose links the backend boosts (graph context). */
  context?: string | null;
  /** Ask for superseded notes too (gap §2; ignored by today's backend). */
  includeSuperseded?: boolean;
  signal?: AbortSignal;
}

interface ScoredSearchResponse extends BackendSearchResponse {
  took_ms?: number;
  results: (BackendSearchHit & { match?: MatchBreakdown })[];
}

/** Hybrid vault search for the palette, with timing and match details. */
export async function searchVault(
  query: string,
  opts: VaultSearchOptions = {},
): Promise<VaultSearch> {
  const params = new URLSearchParams({ q: query });
  if (opts.context) params.set("context", opts.context);
  if (opts.includeSuperseded) params.set("include_superseded", "true");
  const started = performance.now();
  let resp = await apiClient.get<ScoredSearchResponse>(
    `/api/search?${params.toString()}`,
    opts.signal,
  );
  const elapsed = performance.now() - started;
  if (MOCKS_ENABLED) resp = withMockScoring(resp, query, elapsed);
  return {
    query,
    mode: resp.mode === "semantic" ? "hybrid" : "keyword",
    tookMs: Math.round(resp.took_ms ?? elapsed),
    timing: resp.took_ms === undefined ? "client" : "server",
    hits: resp.results.map((hit) => ({
      noteId: hit.id,
      title: hit.title,
      type: narrowType(hit.type),
      tags: hit.tags ?? [],
      snippet: hit.snippet,
      heading: hit.heading,
      score: hit.score,
      match: hit.match ?? null,
    })),
  };
}

import type { VaultSearch, VaultSearchHit } from "@/api/search";
import type { Note } from "@/data/types";

/** Query words worth matching (two characters or more), lowercased. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1),
    ),
  ];
}

export interface TextPart {
  text: string;
  hit: boolean;
}

/** Split `text` into runs that do or don't match any query term. */
export function highlightParts(text: string, query: string): TextPart[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || !text) return [{ text, hit: false }];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return text
    .split(re)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: terms.includes(part.toLowerCase()) }));
}

export type MatchSignal = "keyword" | "semantic" | "graph";

export interface MatchRow {
  signal: MatchSignal;
  label: string;
  /** 0–1, or null when the signal didn't contribute. */
  score: number | null;
  detail: string;
}

export interface MatchExplanation {
  rows: MatchRow[];
  /** "server": scores the search API reported; "estimate": derived here. */
  source: "server" | "estimate";
}

const LABELS: Record<MatchSignal, string> = {
  keyword: "Keyword",
  semantic: "Semantic chunk",
  graph: "Graph proximity",
};

interface ExplainContext {
  /** The note open (or selected in the graph) when the palette opened. */
  contextNote: Note | null;
  noteById: (id: string) => Note | undefined;
}

/** Why a hit matched: the server's breakdown, or an estimate from the hit. */
export function explainMatch(
  hit: VaultSearchHit,
  search: VaultSearch,
  ctx: ExplainContext,
): MatchExplanation {
  if (hit.match) {
    const { keyword, semantic, graph } = hit.match;
    return {
      source: "server",
      rows: [
        row(
          "keyword",
          keyword?.score,
          keyword ? `Rank #${keyword.rank}` : "No keyword match",
        ),
        row(
          "semantic",
          semantic?.score,
          semantic
            ? chunkLabel(semantic.heading, semantic.chunk)
            : "No semantic match",
        ),
        row(
          "graph",
          graph?.boost,
          graph ? "Boosted by links to the open note" : "No graph boost",
        ),
      ],
    };
  }
  return {
    source: "estimate",
    rows: [
      keywordRow(hit, search.query),
      semanticRow(hit, search),
      graphRow(hit, ctx),
    ],
  };
}

function row(
  signal: MatchSignal,
  score: number | undefined,
  detail: string,
): MatchRow {
  return { signal, label: LABELS[signal], score: score ?? null, detail };
}

function chunkLabel(heading: string, chunk: string): string {
  return heading ? `## ${heading}` : chunk.slice(0, 80) || "Body text";
}

function keywordRow(hit: VaultSearchHit, query: string): MatchRow {
  const terms = queryTerms(query);
  const title = hit.title.toLowerCase();
  const text = `${title} ${hit.snippet.toLowerCase()}`;
  const found = terms.filter((t) => text.includes(t));
  if (terms.length === 0 || found.length === 0)
    return row("keyword", undefined, "No exact term match");
  const where = found.some((t) => title.includes(t)) ? "title" : "text";
  return row(
    "keyword",
    found.length / terms.length,
    `${found.length} of ${terms.length} terms in the ${where}`,
  );
}

function semanticRow(hit: VaultSearchHit, search: VaultSearch): MatchRow {
  if (search.offline)
    return row(
      "semantic",
      undefined,
      "Search API unreachable; titles and tags only",
    );
  if (search.mode !== "hybrid")
    return row(
      "semantic",
      undefined,
      "Semantic search is off (no embedding model)",
    );
  const top = Math.max(...search.hits.map((h) => h.score), 0);
  return row(
    "semantic",
    top > 0 ? hit.score / top : undefined,
    chunkLabel(hit.heading, hit.snippet),
  );
}

function graphRow(hit: VaultSearchHit, ctx: ExplainContext): MatchRow {
  const from = ctx.contextNote;
  if (!from || from.id === hit.noteId)
    return row("graph", undefined, "No open note to measure from");
  const neighbors = (id: string) => {
    const note = ctx.noteById(id);
    return new Set(note?.links ?? []);
  };
  const direct = neighbors(from.id);
  if (direct.has(hit.noteId) || neighbors(hit.noteId).has(from.id))
    return row("graph", 1, `Linked to ${from.title}`);
  for (const id of direct)
    if (neighbors(id).has(hit.noteId))
      return row("graph", 0.5, `Two links from ${from.title}`);
  return row("graph", 0, `Not linked to ${from.title}`);
}

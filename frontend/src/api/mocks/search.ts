import type {
  BackendSearchHit,
  BackendSearchResponse,
  MatchBreakdown,
} from "../search";

type Scored = BackendSearchResponse & {
  took_ms?: number;
  results: (BackendSearchHit & { match?: MatchBreakdown })[];
};

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Stand-in for the server's per-signal scores (gap §4): keyword overlap with
 * the title and snippet, a semantic chunk with a rank-derived score, and a
 * small graph boost on alternate hits. Deterministic for a given response.
 */
export function withMockScoring(
  resp: BackendSearchResponse,
  query: string,
  elapsedMs: number,
): Scored {
  const words = terms(query);
  let keywordRank = 0;
  return {
    ...resp,
    took_ms: Math.max(4, Math.round(elapsedMs * 0.6)),
    results: resp.results.map((hit, i) => {
      const text = `${hit.title} ${hit.snippet}`.toLowerCase();
      const found = words.filter((w) => text.includes(w)).length;
      const match: MatchBreakdown = {};
      if (found > 0)
        match.keyword = {
          rank: ++keywordRank,
          score: +(found / Math.max(1, words.length)).toFixed(2),
        };
      if (resp.mode === "semantic")
        match.semantic = {
          chunk: hit.snippet.slice(0, 140),
          heading: hit.heading,
          score: +Math.max(0.35, 0.92 - i * 0.07).toFixed(2),
        };
      if (i % 2 === 0) match.graph = { boost: +(0.3 - i * 0.02).toFixed(2) };
      return { ...hit, match };
    }),
  };
}

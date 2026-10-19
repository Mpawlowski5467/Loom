import type { VaultSearch, VaultSearchHit } from "@/api/search";
import type { Note } from "@/data/types";
import { queryTerms } from "./match";

/**
 * Title and tag matching over the loaded notes, for when the search API is
 * unreachable (offline, demo mode). Every query term must match.
 */
export function localSearch(
  notes: readonly Note[],
  query: string,
): VaultSearch {
  const terms = queryTerms(query);
  const hits: VaultSearchHit[] = notes
    .filter((n) => n.status !== "archived")
    .map((n) => {
      const hay = `${n.title} ${n.tags.join(" ")}`.toLowerCase();
      const score = terms.length && terms.every((t) => hay.includes(t)) ? 1 : 0;
      return {
        n,
        score: score && (n.title.toLowerCase().startsWith(terms[0]!) ? 2 : 1),
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.n.title.localeCompare(b.n.title))
    .slice(0, 20)
    .map(({ n, score }) => ({
      noteId: n.id,
      title: n.title,
      type: n.type,
      tags: n.tags,
      snippet: n.body.slice(0, 240),
      heading: "",
      score,
      match: null,
    }));
  return {
    query,
    hits,
    mode: "keyword",
    tookMs: 0,
    timing: "client",
    offline: true,
  };
}

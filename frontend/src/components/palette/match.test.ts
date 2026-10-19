import { describe, expect, it } from "vitest";
import type { VaultSearch, VaultSearchHit } from "@/api/search";
import type { Note } from "@/data/types";
import { explainMatch, highlightParts, queryTerms } from "./match";

const hit = (patch: Partial<VaultSearchHit> = {}): VaultSearchHit => ({
  noteId: "b",
  title: "Cache plan",
  type: "project",
  tags: [],
  snippet: "Invalidation is event-based.",
  heading: "Rollout",
  score: 0.02,
  match: null,
  ...patch,
});

const search = (
  hits: VaultSearchHit[],
  mode: VaultSearch["mode"] = "hybrid",
): VaultSearch => ({
  query: "cache invalidation",
  hits,
  mode,
  tookMs: 12,
  timing: "client",
});

const note = (id: string, links: string[]) =>
  ({ id, title: id.toUpperCase(), links }) as unknown as Note;

describe("highlightParts", () => {
  it("marks every query term, case-insensitively", () => {
    expect(highlightParts("Cache plan for the cache", "cache")).toEqual([
      { text: "Cache", hit: true },
      { text: " plan for the ", hit: false },
      { text: "cache", hit: true },
    ]);
  });

  it("ignores one-letter terms and regex characters", () => {
    expect(queryTerms("a (b) cd")).toEqual(["(b)", "cd"]);
    expect(highlightParts("x (b) y", "(b)")).toEqual([
      { text: "x ", hit: false },
      { text: "(b)", hit: true },
      { text: " y", hit: false },
    ]);
  });
});

describe("explainMatch", () => {
  it("uses the server's breakdown when the search reports one", () => {
    const h = hit({
      match: {
        keyword: { rank: 2, score: 0.5 },
        semantic: { chunk: "text", heading: "Rollout", score: 0.8 },
      },
    });
    const out = explainMatch(h, search([h]), {
      contextNote: null,
      noteById: () => undefined,
    });
    expect(out.source).toBe("server");
    expect(out.rows.map((r) => [r.label, r.score, r.detail])).toEqual([
      ["Keyword", 0.5, "Rank #2"],
      ["Semantic chunk", 0.8, "## Rollout"],
      ["Graph proximity", null, "No graph boost"],
    ]);
  });

  it("estimates keyword, semantic and graph signals otherwise", () => {
    const top = hit({ noteId: "x", score: 0.04 });
    const h = hit();
    const notes = {
      a: note("a", ["c"]),
      b: note("b", []),
      c: note("c", ["b"]),
    };
    const out = explainMatch(h, search([top, h]), {
      contextNote: notes.a,
      noteById: (id) => notes[id as keyof typeof notes],
    });
    expect(out.source).toBe("estimate");
    expect(out.rows.map((r) => [r.score, r.detail])).toEqual([
      [1, "2 of 2 terms in the title"],
      [0.5, "## Rollout"],
      [0.5, "Two links from A"],
    ]);
  });

  it("explains a keyword-only search and a missing context note", () => {
    const h = hit({ title: "Other", snippet: "nothing here" });
    const out = explainMatch(h, search([h], "keyword"), {
      contextNote: null,
      noteById: () => undefined,
    });
    expect(out.rows.map((r) => [r.score, r.detail])).toEqual([
      [null, "No exact term match"],
      [null, "Semantic search is off (no embedding model)"],
      [null, "No open note to measure from"],
    ]);
  });
});

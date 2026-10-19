import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { withMockScoring } from "./mocks/search";
import { searchVault } from "./search";

afterEach(() => vi.restoreAllMocks());

const response = {
  query: "cache",
  mode: "semantic",
  results: [
    {
      id: "n1",
      title: "Cache plan",
      type: "project",
      tags: ["infra"],
      snippet: "Read cache",
      score: 0.03,
      heading: "Rollout",
    },
    {
      id: "n2",
      title: "Latency",
      type: "weird",
      tags: [],
      snippet: "p95 targets",
      score: 0.02,
      heading: "",
    },
  ],
};

describe("searchVault", () => {
  it("maps hits, reports hybrid mode and times the request", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(response);
    const out = await searchVault("cache", { context: "n9" });
    expect(get).toHaveBeenCalledWith(
      "/api/search?q=cache&context=n9",
      undefined,
    );
    expect(out.mode).toBe("hybrid");
    expect(out.timing).toBe("client");
    expect(out.tookMs).toBeGreaterThanOrEqual(0);
    expect(out.hits).toEqual([
      {
        noteId: "n1",
        title: "Cache plan",
        type: "project",
        tags: ["infra"],
        snippet: "Read cache",
        heading: "Rollout",
        score: 0.03,
        match: null,
      },
      expect.objectContaining({ noteId: "n2", type: "custom" }),
    ]);
  });

  it("passes include_superseded and prefers server timing and breakdowns", async () => {
    const match = { keyword: { rank: 1, score: 0.9 } };
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({
      ...response,
      mode: "keyword",
      took_ms: 41,
      results: [{ ...response.results[0], match }],
    });
    const out = await searchVault("cache", { includeSuperseded: true });
    expect(get).toHaveBeenCalledWith(
      "/api/search?q=cache&include_superseded=true",
      undefined,
    );
    expect(out).toMatchObject({
      mode: "keyword",
      tookMs: 41,
      timing: "server",
    });
    expect(out.hits[0]!.match).toEqual(match);
  });
});

describe("withMockScoring", () => {
  it("adds server-style timing and per-signal scores", () => {
    const out = withMockScoring(response as never, "cache plan", 50);
    expect(out.took_ms).toBe(30);
    expect(out.results[0]!.match).toEqual({
      keyword: { rank: 1, score: 1 },
      semantic: { chunk: "Read cache", heading: "Rollout", score: 0.92 },
      graph: { boost: 0.3 },
    });
    expect(out.results[1]!.match).toEqual({
      semantic: { chunk: "p95 targets", heading: "", score: 0.85 },
    });
  });
});

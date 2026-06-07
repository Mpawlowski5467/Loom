import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { fetchRun, listRuns, type RunDetail, type RunSummary } from "./runs";

afterEach(() => {
  vi.restoreAllMocks();
});

function mkRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: "run_1",
    agent: "researcher",
    status: "ok",
    started: "2026-06-06T10:00:00Z",
    ended: "2026-06-06T10:00:01Z",
    duration_ms: 12,
    steps: [
      { name: "search", status: "ok", duration_ms: 3, trace_ids: [], error: "" },
      { name: "synthesize", status: "ok", duration_ms: 9, trace_ids: ["trc_1"], error: "" },
    ],
    ...overrides,
  };
}

describe("listRuns", () => {
  it("requests recent runs with the limit", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue([mkRun()]);
    const runs = await listRuns(10);
    expect(spy).toHaveBeenCalledWith("/api/traces/runs?limit=10");
    expect(runs[0]!.agent).toBe("researcher");
    expect(runs[0]!.steps.map((s) => s.name)).toEqual(["search", "synthesize"]);
  });

  it("defaults the limit to 50", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue([]);
    await listRuns();
    expect(spy).toHaveBeenCalledWith("/api/traces/runs?limit=50");
  });
});

describe("fetchRun", () => {
  it("fetches one run and parses its step traces", async () => {
    const detail: RunDetail = {
      ...mkRun({ run_id: "run_x" }),
      traces: {
        search: [],
        synthesize: [
          {
            id: "trc_1",
            timestamp: "2026-06-06T10:00:01Z",
            provider: "stub",
            model: "m",
            caller: "researcher",
            system: "",
            messages: [],
            response: "answer",
            duration_ms: 9,
            error: "",
            run_id: "run_x",
            step: "synthesize",
          },
        ],
      },
    };
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue(detail);
    const result = await fetchRun("run_x");
    expect(spy).toHaveBeenCalledWith("/api/traces/runs/run_x");
    expect(result.traces.synthesize![0]!.step).toBe("synthesize");
    expect(result.traces.search).toEqual([]);
  });
});

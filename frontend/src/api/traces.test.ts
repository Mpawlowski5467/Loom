import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { fetchTrace, listTraces, type TraceSummary } from "./traces";

afterEach(() => {
  vi.restoreAllMocks();
});

function mkSummary(overrides: Partial<TraceSummary> = {}): TraceSummary {
  return {
    id: "trc_1",
    timestamp: "2026-07-05T10:00:00Z",
    provider: "stub",
    model: "stub-model",
    caller: "manual:scout",
    duration_ms: 12,
    error: "",
    response_preview: "hello",
    ...overrides,
  };
}

describe("fetchTrace", () => {
  it("fetches one trace by id", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue({});
    await fetchTrace("trc_1");
    expect(spy).toHaveBeenCalledWith("/api/traces/trc_1");
  });
});

describe("listTraces", () => {
  it("requests recent traces with the limit", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue([mkSummary()]);
    const traces = await listTraces(200);
    expect(spy).toHaveBeenCalledWith("/api/traces?limit=200");
    expect(traces[0]!.caller).toBe("manual:scout");
  });

  it("defaults the limit to 50 and omits the caller param", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue([]);
    await listTraces();
    expect(spy).toHaveBeenCalledWith("/api/traces?limit=50");
  });

  it("passes the caller filter when given", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue([]);
    await listTraces(10, "manual:scout");
    expect(spy).toHaveBeenCalledWith("/api/traces?limit=10&caller=manual%3Ascout");
  });
});

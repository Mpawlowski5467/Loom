import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { Tab } from "../data/types";
import { GRAPH_DISPLAY_DEFAULTS } from "./app-ctx";
import { useGraphNavigation } from "./useGraphNavigation";

describe("useGraphNavigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it("owns fly-to, filters, bounded display settings, and persistence", () => {
    const setTab = vi.fn() as unknown as Dispatch<SetStateAction<Tab>>;
    const { result } = renderHook(() => useGraphNavigation(null, setTab));

    act(() => {
      result.current.flyToNode("thr_target");
      result.current.toggleGraphFilter("topic");
      result.current.setGraphDisplay({
        nodeSizeScale: 99,
        labelSize: -1,
        layout: "galaxy",
      });
    });

    expect(setTab).toHaveBeenCalledWith("graph");
    expect(result.current.graphFlyTo).toEqual({ id: "thr_target", nonce: 1 });
    expect(result.current.graphFilters).toEqual(new Set(["topic"]));
    expect(result.current.graphDisplay.nodeSizeScale).toBe(2);
    expect(result.current.graphDisplay.labelSize).toBe(8);
    expect(result.current.graphDisplay.layout).toBe("galaxy");

    act(() => vi.advanceTimersByTime(301));
    expect(
      JSON.parse(localStorage.getItem("loom.graphFilters") ?? "[]"),
    ).toEqual(["topic"]);
    expect(
      JSON.parse(localStorage.getItem("loom.graphDisplay") ?? "{}").layout,
    ).toBe("galaxy");
  });

  it("loads valid persisted settings and migrates orbitAutoCycle", () => {
    localStorage.setItem(
      "loom.graphFilters",
      JSON.stringify(["daily", "bogus"]),
    );
    localStorage.setItem(
      "loom.graphDisplay",
      JSON.stringify({ layout: "wave", orbitAutoCycle: true }),
    );

    const { result } = renderHook(() =>
      useGraphNavigation(null, vi.fn() as never),
    );

    expect(result.current.graphFilters).toEqual(new Set(["daily"]));
    expect(result.current.graphDisplay.layout).toBe("wave");
    expect(result.current.graphDisplay.layoutAutoCycle).toBe(true);
  });

  it("keeps disposable fixture runs isolated from user preferences", () => {
    localStorage.setItem("loom.graphFilters", JSON.stringify(["topic"]));
    localStorage.setItem(
      "loom.graphDisplay",
      JSON.stringify({ layout: "wave" }),
    );

    const { result } = renderHook(() =>
      useGraphNavigation(2000, vi.fn() as never),
    );

    expect(result.current.graphFilters.size).toBe(0);
    expect(result.current.graphDisplay).toEqual(GRAPH_DISPLAY_DEFAULTS);
    act(() => {
      result.current.toggleGraphFilter("project");
      vi.advanceTimersByTime(500);
    });
    expect(localStorage.getItem("loom.graphFilters")).toBe(
      JSON.stringify(["topic"]),
    );
  });
});

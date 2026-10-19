import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { Tab } from "../data/types";
import { GRAPH_DISPLAY_DEFAULTS } from "./app-ctx";
import { DEFAULT_NODE_FILTER } from "../graph/nodeFilter";
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
      result.current.setGraphFilter({ folder: "topics", createdBefore: 5 });
      result.current.setGraphDisplay({
        nodeSizeScale: 99,
        labelSize: -1,
        layout: "galaxy",
      });
    });

    expect(setTab).toHaveBeenCalledWith("graph");
    expect(result.current.graphFlyTo).toEqual({ id: "thr_target", nonce: 1 });
    expect(result.current.graphFilter).toMatchObject({
      folder: "topics",
      createdBefore: 5,
    });
    expect(result.current.graphDisplay.nodeSizeScale).toBe(2);
    expect(result.current.graphDisplay.labelSize).toBe(8);
    expect(result.current.graphDisplay.layout).toBe("galaxy");

    act(() => vi.advanceTimersByTime(301));
    // The timeline position is a view of the moment; it isn't persisted.
    expect(
      JSON.parse(localStorage.getItem("loom.graphFilter.v2") ?? "{}"),
    ).toEqual({ folder: "topics", community: null, showSuperseded: false });
    expect(
      JSON.parse(localStorage.getItem("loom.graphDisplay") ?? "{}").layout,
    ).toBe("galaxy");
  });

  it("loads valid persisted settings and migrates orbitAutoCycle", () => {
    localStorage.setItem(
      "loom.graphFilter.v2",
      JSON.stringify({
        folder: "projects",
        community: 9,
        showSuperseded: true,
        createdBefore: 5,
      }),
    );
    localStorage.setItem(
      "loom.graphDisplay",
      JSON.stringify({ layout: "wave", orbitAutoCycle: true }),
    );

    const { result } = renderHook(() =>
      useGraphNavigation(null, vi.fn() as never),
    );

    expect(result.current.graphFilter).toEqual({
      folder: "projects",
      community: null,
      showSuperseded: true,
      createdBefore: null,
    });
    expect(result.current.graphDisplay.layout).toBe("wave");
    expect(result.current.graphDisplay.layoutAutoCycle).toBe(true);
  });

  it("keeps disposable fixture runs isolated from user preferences", () => {
    const stored = JSON.stringify({ folder: "topics" });
    localStorage.setItem("loom.graphFilter.v2", stored);
    localStorage.setItem(
      "loom.graphDisplay",
      JSON.stringify({ layout: "wave" }),
    );

    const { result } = renderHook(() =>
      useGraphNavigation(2000, vi.fn() as never),
    );

    expect(result.current.graphFilter).toEqual(DEFAULT_NODE_FILTER);
    expect(result.current.graphDisplay).toEqual(GRAPH_DISPLAY_DEFAULTS);
    act(() => {
      result.current.setGraphFilter({ folder: "projects" });
      vi.advanceTimersByTime(500);
    });
    expect(localStorage.getItem("loom.graphFilter.v2")).toBe(stored);
  });
});

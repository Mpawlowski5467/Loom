import { describe, expect, it } from "vitest";
import Graph from "graphology";
import type { Note, NodeType } from "../data/types";
import {
  applyGraphVisibility,
  computePositionBBox,
  computeVisibleGraphBBox,
  computeVisibleDegreeMap,
  computeVisibleGraphStats,
  computeVisibleNeighborIds,
  isGraphNodeVisible,
} from "./filtering";
import { DEFAULT_NODE_FILTER, type GraphNodeFilter } from "./nodeFilter";

function note(id: string, type: NodeType, links: string[] = []): Note {
  return {
    id,
    title: id,
    type,
    folder: `${type}s`,
    tags: [],
    body: "",
    links,
    history: [],
    created: "2026-07-11T00:00:00Z",
    modified: "2026-07-11T00:00:00Z",
    status: "active",
    source: "manual",
  };
}

const ALL = DEFAULT_NODE_FILTER;
const only = (patch: Partial<GraphNodeFilter>): GraphNodeFilter => ({
  ...DEFAULT_NODE_FILTER,
  ...patch,
});

describe("graph visibility", () => {
  it("materializes hidden attributes and reports visible nodes", () => {
    const graph = new Graph();
    graph.addNode("p", { folder: "projects" });
    graph.addNode("t", { folder: "topics", hidden: true });

    expect(
      applyGraphVisibility(graph, { filter: only({ folder: "topics" }) })
        .visibleCount,
    ).toBe(1);
    expect(isGraphNodeVisible(graph, "p")).toBe(false);
    expect(isGraphNodeVisible(graph, "t")).toBe(true);

    expect(applyGraphVisibility(graph, { filter: ALL }).visibleCount).toBe(2);
    expect(isGraphNodeVisible(graph, "p")).toBe(true);
    expect(isGraphNodeVisible(graph, "t")).toBe(true);
  });

  it("hides superseded notes and later notes on the timeline", () => {
    const graph = new Graph();
    graph.addNode("old", { superseded: true, created: 100 });
    graph.addNode("early", { created: 100 });
    graph.addNode("late", { created: 300 });

    const result = applyGraphVisibility(graph, {
      filter: only({ createdBefore: 200 }),
    });
    expect(result).toMatchObject({ visibleCount: 1, restricted: true });
    expect(isGraphNodeVisible(graph, "early")).toBe(true);
    expect(isGraphNodeVisible(graph, "old")).toBe(false);
    expect(isGraphNodeVisible(graph, "late")).toBe(false);

    applyGraphVisibility(graph, { filter: only({ showSuperseded: true }) });
    expect(isGraphNodeVisible(graph, "old")).toBe(true);
  });

  it("filters by community slot or the Other bucket", () => {
    const graph = new Graph();
    graph.addNode("a", { community: 0 });
    graph.addNode("b", { community: 1 });
    graph.addNode("c", { community: null });

    applyGraphVisibility(graph, { filter: only({ community: 1 }) });
    expect(
      ["a", "b", "c"].filter((id) => isGraphNodeVisible(graph, id)),
    ).toEqual(["b"]);
    applyGraphVisibility(graph, { filter: only({ community: "other" }) });
    expect(
      ["a", "b", "c"].filter((id) => isGraphNodeVisible(graph, id)),
    ).toEqual(["c"]);
  });

  it("computes degree only through visible endpoints", () => {
    const graph = new Graph();
    graph.addNode("a");
    graph.addNode("b");
    graph.addNode("hidden", { hidden: true });
    graph.addEdge("a", "b");
    graph.addEdge("a", "hidden");

    expect(computeVisibleDegreeMap(graph)).toEqual(
      new Map([
        ["a", 1],
        ["b", 1],
        ["hidden", 0],
      ]),
    );
  });

  it("intersects direct-neighbor isolation with the filter", () => {
    const graph = new Graph();
    graph.addNode("selected", { folder: "projects" });
    graph.addNode("direct", { folder: "projects" });
    graph.addNode("second-hop", { folder: "projects" });
    graph.addNode("filtered-direct", { folder: "daily" });
    graph.addEdge("selected", "direct");
    graph.addEdge("direct", "second-hop");
    graph.addEdge("filtered-direct", "selected");
    const filter = only({ folder: "projects" });

    const result = applyGraphVisibility(graph, {
      filter,
      selectedId: "selected",
      isolateNeighbors: true,
    });

    expect(result).toEqual({
      visibleCount: 2,
      selectedVisible: true,
      isolationActive: true,
      restricted: true,
    });
    expect(isGraphNodeVisible(graph, "direct")).toBe(true);
    expect(isGraphNodeVisible(graph, "second-hop")).toBe(false);
    expect(graph.getNodeAttribute("second-hop", "hiddenByIsolation")).toBe(
      true,
    );
    expect(graph.getNodeAttribute("filtered-direct", "hiddenByFilter")).toBe(
      true,
    );

    applyGraphVisibility(graph, { filter });
    expect(isGraphNodeVisible(graph, "second-hop")).toBe(true);
    expect(isGraphNodeVisible(graph, "filtered-direct")).toBe(false);
  });

  it("does not activate isolation when the filter hides the selected node", () => {
    const graph = new Graph();
    graph.addNode("selected", { folder: "projects" });
    graph.addNode("topic", { folder: "topics" });
    graph.addEdge("selected", "topic");

    const result = applyGraphVisibility(graph, {
      filter: only({ folder: "topics" }),
      selectedId: "selected",
      isolateNeighbors: true,
    });

    expect(result.selectedVisible).toBe(false);
    expect(result.isolationActive).toBe(false);
    expect(result.visibleCount).toBe(1);
    expect(isGraphNodeVisible(graph, "topic")).toBe(true);
  });

  it("computes a padded viewport box from visible nodes only", () => {
    const graph = new Graph();
    graph.addNode("a", { x: 10, y: 20 });
    graph.addNode("b", { x: 30, y: 60 });
    graph.addNode("hidden", { x: 10_000, y: 10_000, hidden: true });

    expect(computeVisibleGraphBBox(graph)).toEqual({
      x: [9, 31],
      y: [18, 62],
    });
  });

  it("expands degenerate bounds and ignores non-finite positions", () => {
    expect(
      computePositionBBox([
        { x: Number.NaN, y: 0 },
        { x: 5, y: 7 },
      ]),
    ).toEqual({ x: [4, 6], y: [6, 8] });
    expect(computePositionBBox([{ x: Number.NaN, y: 0 }])).toBeNull();
  });
});

describe("computeVisibleGraphStats", () => {
  const notes = [
    note("a", "topic", ["b", "b", "missing"]),
    note("b", "project", ["a", "c"]),
    note("c", "topic", []),
    note("d", "daily", ["d"]),
  ];

  it("matches buildGraph's valid, unique undirected edge semantics", () => {
    expect(computeVisibleGraphStats(notes, ALL)).toEqual({
      nodes: 4,
      edges: 3,
    });
  });

  it("counts only edges in the visible induced subgraph", () => {
    expect(computeVisibleGraphStats(notes, only({ folder: "topics" }))).toEqual(
      { nodes: 2, edges: 0 },
    );
    const slotOf = new Map([
      ["a", 0],
      ["b", 0],
      ["c", 0],
      ["d", null],
    ]);
    expect(
      computeVisibleGraphStats(notes, only({ community: 0 }), {}, slotOf),
    ).toEqual({ nodes: 3, edges: 2 });
  });

  it("counts only the selected node and its direct visible neighbors", () => {
    const scoped = [
      note("selected", "project", ["out"]),
      note("out", "project", ["second-hop"]),
      note("in", "project", ["selected"]),
      note("second-hop", "project"),
      note("filtered", "daily", ["selected"]),
    ];
    const filter = only({ folder: "projects" });

    expect(computeVisibleNeighborIds(scoped, filter, "selected")).toEqual(
      new Set(["out", "in"]),
    );
    expect(
      computeVisibleGraphStats(scoped, filter, {
        selectedId: "selected",
        isolateNeighbors: true,
      }),
    ).toEqual({ nodes: 3, edges: 2 });
  });
});

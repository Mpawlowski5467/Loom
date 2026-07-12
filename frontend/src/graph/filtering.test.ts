import { describe, expect, it } from "vitest";
import Graph from "graphology";
import type { Note, NodeType } from "../data/types";
import {
  NODE_TYPES,
  applyGraphFilters,
  applyGraphVisibility,
  computePositionBBox,
  computeVisibleGraphBBox,
  computeVisibleDegreeMap,
  computeVisibleGraphStats,
  computeVisibleNeighborIds,
  isGraphNodeVisible,
  isNodeTypeVisible,
  sanitizeGraphFilters,
} from "./filtering";

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

describe("sanitizeGraphFilters", () => {
  it("exports every canonical node type", () => {
    expect(NODE_TYPES).toEqual([
      "project",
      "topic",
      "people",
      "daily",
      "capture",
      "custom",
    ]);
  });

  it("keeps valid values, deduplicates, and migrates person to people", () => {
    expect([
      ...sanitizeGraphFilters(["topic", "person", "topic", " DAILY "]),
    ]).toEqual(["topic", "people", "daily"]);
  });

  it("rejects malformed containers and unknown values", () => {
    expect(sanitizeGraphFilters("topic")).toEqual(new Set());
    expect(sanitizeGraphFilters([null, 4, "bogus"])).toEqual(new Set());
  });
});

describe("graph visibility", () => {
  it("treats an empty set as all visible and a non-empty set as inclusion", () => {
    expect(isNodeTypeVisible("topic", new Set())).toBe(true);
    expect(isNodeTypeVisible("topic", new Set(["topic"]))).toBe(true);
    expect(isNodeTypeVisible("project", new Set(["topic"]))).toBe(false);
  });

  it("materializes hidden attributes and reports visible nodes", () => {
    const graph = new Graph();
    graph.addNode("p", { noteType: "project" });
    graph.addNode("t", { noteType: "topic", hidden: true });

    expect(applyGraphFilters(graph, new Set(["topic"]))).toBe(1);
    expect(isGraphNodeVisible(graph, "p")).toBe(false);
    expect(isGraphNodeVisible(graph, "t")).toBe(true);

    expect(applyGraphFilters(graph, new Set())).toBe(2);
    expect(isGraphNodeVisible(graph, "p")).toBe(true);
    expect(isGraphNodeVisible(graph, "t")).toBe(true);
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

  it("intersects direct-neighbor isolation with type filters", () => {
    const graph = new Graph();
    graph.addNode("selected", { noteType: "project" });
    graph.addNode("direct", { noteType: "topic" });
    graph.addNode("second-hop", { noteType: "topic" });
    graph.addNode("filtered-direct", { noteType: "daily" });
    graph.addEdge("selected", "direct");
    graph.addEdge("direct", "second-hop");
    graph.addEdge("filtered-direct", "selected");

    const result = applyGraphVisibility(graph, {
      typeFilters: new Set(["project", "topic"]),
      selectedId: "selected",
      isolateNeighbors: true,
    });

    expect(result).toEqual({
      visibleCount: 2,
      selectedVisible: true,
      isolationActive: true,
      restricted: true,
    });
    expect(isGraphNodeVisible(graph, "selected")).toBe(true);
    expect(isGraphNodeVisible(graph, "direct")).toBe(true);
    expect(isGraphNodeVisible(graph, "second-hop")).toBe(false);
    expect(graph.getNodeAttribute("second-hop", "hiddenByIsolation")).toBe(
      true,
    );
    expect(graph.getNodeAttribute("filtered-direct", "hiddenByType")).toBe(
      true,
    );

    applyGraphVisibility(graph, {
      typeFilters: new Set(["project", "topic"]),
    });
    expect(isGraphNodeVisible(graph, "second-hop")).toBe(true);
    expect(isGraphNodeVisible(graph, "filtered-direct")).toBe(false);
  });

  it("does not activate isolation when filters hide the selected node", () => {
    const graph = new Graph();
    graph.addNode("selected", { noteType: "project" });
    graph.addNode("topic", { noteType: "topic" });
    graph.addEdge("selected", "topic");

    const result = applyGraphVisibility(graph, {
      typeFilters: new Set(["topic"]),
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
    expect(computeVisibleGraphStats(notes, new Set())).toEqual({
      nodes: 4,
      edges: 3,
    });
  });

  it("counts only edges in the visible induced subgraph", () => {
    expect(computeVisibleGraphStats(notes, new Set(["topic"]))).toEqual({
      nodes: 2,
      edges: 0,
    });
    expect(
      computeVisibleGraphStats(notes, new Set(["topic", "project"])),
    ).toEqual({ nodes: 3, edges: 2 });
  });

  it("counts only the selected node and its direct visible neighbors", () => {
    const scoped = [
      note("selected", "project", ["out"]),
      note("out", "topic", ["second-hop"]),
      note("in", "topic", ["selected"]),
      note("second-hop", "topic"),
      note("filtered", "daily", ["selected"]),
    ];

    expect(
      computeVisibleNeighborIds(
        scoped,
        new Set(["project", "topic"]),
        "selected",
      ),
    ).toEqual(new Set(["out", "in"]));
    expect(
      computeVisibleGraphStats(scoped, new Set(["project", "topic"]), {
        selectedId: "selected",
        isolateNeighbors: true,
      }),
    ).toEqual({ nodes: 3, edges: 2 });
  });
});

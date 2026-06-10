/*
Frontend testing conventions:
- Pure layout math: construct a graph, run the pass, assert positions.
*/
import { describe, expect, it } from "vitest";
import Graph from "graphology";
import { resolveOverlaps } from "./overlap";

function makeGraph(
  nodes: Array<{ id: string; x: number; y: number; size?: number }>,
): Graph {
  const g = new Graph();
  for (const n of nodes) {
    g.addNode(n.id, { x: n.x, y: n.y, size: n.size ?? 4 });
  }
  return g;
}

function pos(g: Graph, id: string): { x: number; y: number } {
  return {
    x: g.getNodeAttribute(id, "x") as number,
    y: g.getNodeAttribute(id, "y") as number,
  };
}

function dist(g: Graph, a: string, b: string): number {
  const pa = pos(g, a);
  const pb = pos(g, b);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

describe("resolveOverlaps", () => {
  it("separates two stacked nodes", () => {
    // Spread companions establish the bbox extent the px→unit scale uses.
    const g = makeGraph([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 0.5, y: 0 },
      { id: "far1", x: -450, y: -450 },
      { id: "far2", x: 450, y: 450 },
    ]);
    resolveOverlaps(g);
    expect(dist(g, "a", "b")).toBeGreaterThan(1);
    for (const id of ["a", "b", "far1", "far2"]) {
      expect(Number.isFinite(pos(g, id).x)).toBe(true);
      expect(Number.isFinite(pos(g, id).y)).toBe(true);
    }
  });

  it("separates exactly coincident nodes deterministically", () => {
    const run = (): Graph => {
      const g = makeGraph([
        { id: "a", x: 10, y: 10 },
        { id: "b", x: 10, y: 10 },
        { id: "far", x: 800, y: 800 },
      ]);
      resolveOverlaps(g);
      return g;
    };
    const g1 = run();
    const g2 = run();
    expect(dist(g1, "a", "b")).toBeGreaterThan(0);
    // Same input → identical output, every time.
    expect(pos(g1, "a")).toEqual(pos(g2, "a"));
    expect(pos(g1, "b")).toEqual(pos(g2, "b"));
  });

  it("leaves well-separated nodes untouched", () => {
    const g = makeGraph([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 400, y: 0 },
      { id: "c", x: 0, y: 400 },
    ]);
    resolveOverlaps(g);
    expect(pos(g, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(g, "b")).toEqual({ x: 400, y: 0 });
    expect(pos(g, "c")).toEqual({ x: 0, y: 400 });
  });

  it("is a no-op for a single node", () => {
    const g = makeGraph([{ id: "solo", x: 7, y: -3 }]);
    resolveOverlaps(g);
    expect(pos(g, "solo")).toEqual({ x: 7, y: -3 });
  });

  it("resolves a dense cluster without flinging nodes to infinity", () => {
    const nodes = [];
    for (let i = 0; i < 30; i++) {
      nodes.push({ id: `n${String(i).padStart(2, "0")}`, x: i * 0.1, y: 0 });
    }
    nodes.push({ id: "edge1", x: -500, y: -500 });
    nodes.push({ id: "edge2", x: 500, y: 500 });
    const g = makeGraph(nodes);
    resolveOverlaps(g);
    let minPair = Infinity;
    for (let i = 0; i < 30; i++) {
      for (let j = i + 1; j < 30; j++) {
        minPair = Math.min(
          minPair,
          dist(g, `n${String(i).padStart(2, "0")}`, `n${String(j).padStart(2, "0")}`),
        );
      }
    }
    expect(minPair).toBeGreaterThan(0.5);
    g.forEachNode((id) => {
      expect(Math.abs(pos(g, id).x)).toBeLessThan(5_000);
      expect(Math.abs(pos(g, id).y)).toBeLessThan(5_000);
    });
  });
});

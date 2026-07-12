import { describe, it, expect } from "vitest";
import Graph from "graphology";
import {
  easeInOutCubic,
  applyConstellationLayout,
  computeOrbitScene,
  computeOrbitLayout,
  ORBIT_SCENES,
  type OrbitScene,
  type XY,
} from "./layouts";

/** Build a small star + chain graph rooted at "focus".
 *
 *   focus — n1 — n2        (n2 is two hops out)
 *     │
 *     └── n3               (one hop)
 *   iso                    (disconnected → "infinite" distance)
 */
function mkGraph(): Graph {
  const g = new Graph();
  for (const id of ["focus", "n1", "n2", "n3", "iso"]) {
    g.addNode(id, { noteType: "topic" });
  }
  g.addEdge("focus", "n1");
  g.addEdge("n1", "n2");
  g.addEdge("focus", "n3");
  return g;
}

function dist(p: { x: number; y: number }): number {
  return Math.hypot(p.x, p.y);
}

describe("easeInOutCubic", () => {
  it("pins the endpoints and the midpoint", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it("is monotonically increasing", () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe.each(ORBIT_SCENES)("computeOrbitScene(%s)", (scene: OrbitScene) => {
  it("pins the focus node at the origin", () => {
    const positions = computeOrbitScene(mkGraph(), "focus", scene);
    expect(positions.get("focus")).toEqual({ x: 0, y: 0 });
  });

  it("places every node exactly once", () => {
    const g = mkGraph();
    const positions = computeOrbitScene(g, "focus", scene);
    expect(positions.size).toBe(g.order);
    g.forEachNode((id) => {
      expect(positions.has(id)).toBe(true);
    });
  });

  it("produces finite coordinates for all nodes", () => {
    const positions = computeOrbitScene(mkGraph(), "focus", scene);
    for (const { x, y } of positions.values()) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("excludes hidden nodes from the scene", () => {
    const graph = mkGraph();
    graph.setNodeAttribute("n1", "hidden", true);
    const positions = computeOrbitScene(graph, "focus", scene);
    expect(positions.has("n1")).toBe(false);
    expect(positions.size).toBe(graph.order - 1);
  });
});

describe("computeOrbitScene — rings", () => {
  it("orders nodes radially by BFS distance from the focus", () => {
    const positions = computeOrbitScene(mkGraph(), "focus", "rings");
    const n1 = dist(positions.get("n1")!); // 1 hop
    const n2 = dist(positions.get("n2")!); // 2 hops
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBeGreaterThan(n1);
  });

  it("pushes disconnected nodes to the outer ring", () => {
    const positions = computeOrbitScene(mkGraph(), "focus", "rings");
    const iso = dist(positions.get("iso")!);
    const n2 = dist(positions.get("n2")!);
    // The unreachable node sits beyond the farthest reachable ring.
    expect(iso).toBeGreaterThan(n2);
  });

  it("does not traverse through a hidden intermediary", () => {
    const graph = mkGraph();
    graph.setNodeAttribute("n1", "hidden", true);
    const positions = computeOrbitScene(graph, "focus", "rings");
    // n2 is connected only through hidden n1, so it becomes unreachable and
    // moves to the outer ring rather than retaining its former two-hop rank.
    expect(dist(positions.get("n2")!)).toBeGreaterThan(
      dist(positions.get("n3")!),
    );
    expect(dist(positions.get("n2")!)).toBeCloseTo(700);
  });

  it("falls back to the first visible node when the requested focus is hidden", () => {
    const graph = mkGraph();
    graph.setNodeAttribute("focus", "hidden", true);
    const positions = computeOrbitScene(graph, "focus", "rings");
    expect(positions.has("focus")).toBe(false);
    expect(positions.get("n1")).toEqual({ x: 0, y: 0 });
  });

  it("returns no targets when every node is hidden", () => {
    const graph = mkGraph();
    graph.forEachNode((id) => graph.setNodeAttribute(id, "hidden", true));
    expect(computeOrbitScene(graph, "focus", "rings")).toEqual(new Map());
  });
});

describe("computeOrbitLayout", () => {
  it("is the rings scene by default", () => {
    const g = mkGraph();
    expect(computeOrbitLayout(g, "focus")).toEqual(
      computeOrbitScene(g, "focus", "rings"),
    );
  });
});

describe("applyConstellationLayout — seeding", () => {
  it("returns a finite position for every node with no seed", () => {
    const g = mkGraph();
    const pos = applyConstellationLayout(g);
    for (const id of ["focus", "n1", "n2", "n3", "iso"]) {
      const p = pos.get(id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("keeps fully-seeded node positions exactly (no FA2 reshuffle)", () => {
    const g = mkGraph();
    const seed = new Map<string, XY>([
      ["focus", { x: 10, y: 20 }],
      ["n1", { x: 30, y: 40 }],
      ["n2", { x: 50, y: 60 }],
      ["n3", { x: 70, y: 80 }],
      ["iso", { x: 90, y: 100 }],
    ]);
    const pos = applyConstellationLayout(g, seed);
    // Every node is seeded → 0 iterations → positions returned verbatim.
    for (const [id, xy] of seed) {
      expect(pos.get(id)).toEqual(xy);
    }
  });

  it("places a new (unseeded) node while keeping the graph finite", () => {
    const g = mkGraph();
    g.addNode("fresh", { noteType: "topic" });
    g.addEdge("focus", "fresh");
    // Seed everything except the new node.
    const seed = new Map<string, XY>([
      ["focus", { x: 0, y: 0 }],
      ["n1", { x: 100, y: 0 }],
      ["n2", { x: 200, y: 0 }],
      ["n3", { x: 0, y: 100 }],
      ["iso", { x: 0, y: 200 }],
    ]);
    const pos = applyConstellationLayout(g, seed);
    const fresh = pos.get("fresh")!;
    expect(Number.isFinite(fresh.x)).toBe(true);
    expect(Number.isFinite(fresh.y)).toBe(true);
    // The new node got a real placement (not left at the origin default).
    expect(fresh.x !== 0 || fresh.y !== 0).toBe(true);
  });
});

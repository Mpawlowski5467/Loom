import { describe, it, expect } from "vitest";
import Graph from "graphology";
import {
  easeInOutCubic,
  computeOrbitScene,
  computeOrbitLayout,
  ORBIT_SCENES,
  type OrbitScene,
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
});

describe("computeOrbitLayout", () => {
  it("is the rings scene by default", () => {
    const g = mkGraph();
    expect(computeOrbitLayout(g, "focus")).toEqual(
      computeOrbitScene(g, "focus", "rings"),
    );
  });
});

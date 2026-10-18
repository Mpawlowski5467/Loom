import { describe, expect, it } from "vitest";
import type { XY } from "./orbitScenes";
import {
  FALLBACK_SPACING,
  measureLayoutFrame,
  placeNewNodes,
} from "./placement";
import { seededRandom } from "../test/seededRandom";

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Four corners of a 200×200 square centered on the origin. */
function square(): Map<string, XY> {
  return new Map<string, XY>([
    ["a", { x: -100, y: -100 }],
    ["b", { x: 100, y: -100 }],
    ["c", { x: 100, y: 100 }],
    ["d", { x: -100, y: 100 }],
  ]);
}

function adjacency(entries: Record<string, string[]>) {
  return (id: string): string[] => entries[id] ?? [];
}

describe("measureLayoutFrame", () => {
  it("falls back to the spiral step when nothing is placed", () => {
    expect(measureLayoutFrame([])).toEqual({
      cx: 0,
      cy: 0,
      radius: 0,
      spacing: FALLBACK_SPACING,
    });
  });

  it("measures centroid, radius and per-node spacing", () => {
    const frame = measureLayoutFrame(square().values());
    const radius = Math.hypot(100, 100);
    expect(frame.cx).toBeCloseTo(0);
    expect(frame.cy).toBeCloseTo(0);
    expect(frame.radius).toBeCloseTo(radius);
    expect(frame.spacing).toBeCloseTo(radius * Math.sqrt(Math.PI / 4));
  });
});

describe("placeNewNodes", () => {
  const known = square();
  const frame = measureLayoutFrame(known.values());

  it("places a node near the centroid of its placed neighbors", () => {
    const placed = placeNewNodes(["n"], adjacency({ n: ["a", "b"] }), known, {
      random: seededRandom(1),
    });
    const p = placed.get("n")!;
    // Midpoint of a and b, within one node's jitter radius.
    expect(dist(p, { x: 0, y: -100 })).toBeLessThanOrEqual(
      frame.spacing * 0.6 + 1e-9,
    );
    // Known nodes are never written.
    expect(placed.has("a")).toBe(false);
    expect(known.get("a")).toEqual({ x: -100, y: -100 });
  });

  it("widens the jitter with sqrt(new-node count)", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `n${i}`);
    const neighbors = adjacency(
      Object.fromEntries(ids.map((id) => [id, ["c"]])),
    );
    const placed = placeNewNodes(ids, neighbors, known, {
      random: seededRandom(7),
    });
    const anchor = known.get("c")!;
    const single = frame.spacing * 0.6;
    const spread = ids.map((id) => dist(placed.get(id)!, anchor));
    // Every node stays inside the batch's disk (radius × sqrt(16) = 4×)…
    expect(Math.max(...spread)).toBeLessThanOrEqual(single * 4 + 1e-9);
    // …and the batch uses the wider disk instead of piling up within the
    // one-node radius.
    expect(spread.filter((d) => d > single).length).toBeGreaterThan(4);
  });

  it("puts a node with no placed neighbor in a ring just outside the layout", () => {
    const placed = placeNewNodes(["orphan"], adjacency({}), known, {
      random: seededRandom(3),
    });
    const r = dist(placed.get("orphan")!, { x: frame.cx, y: frame.cy });
    expect(r).toBeGreaterThanOrEqual(frame.radius * 1.04 - 1e-9);
    expect(r).toBeLessThanOrEqual(frame.radius * 1.14 + 1e-9);
  });

  it("grows a new cluster around its first ring-placed member", () => {
    const neighbors = adjacency({ x: ["y"], y: ["x"] });
    const placed = placeNewNodes(["x", "y"], neighbors, known, {
      random: seededRandom(5),
    });
    const jitter = frame.spacing * 0.6 * Math.sqrt(2);
    expect(dist(placed.get("y")!, placed.get("x")!)).toBeLessThanOrEqual(
      jitter + 1e-9,
    );
  });

  it("places a node beside a neighbor placed later in the same batch", () => {
    // p only links to q; q links to the known node a. Listed first, p must
    // wait for q instead of being thrown onto the ring.
    const neighbors = adjacency({ p: ["q"], q: ["p", "a"] });
    const placed = placeNewNodes(["p", "q"], neighbors, known, {
      random: seededRandom(11),
    });
    const jitter = frame.spacing * 0.6 * Math.sqrt(2);
    const q = placed.get("q")!;
    expect(dist(q, known.get("a")!)).toBeLessThanOrEqual(
      dist(q, { x: frame.cx, y: frame.cy }) + jitter,
    );
    expect(dist(placed.get("p")!, q)).toBeLessThanOrEqual(jitter + 1e-9);
  });

  it("is deterministic for a given random source", () => {
    const neighbors = adjacency({ n: ["a"], m: [] });
    const first = placeNewNodes(["n", "m"], neighbors, known, {
      random: seededRandom(42),
    });
    const second = placeNewNodes(["n", "m"], neighbors, known, {
      random: seededRandom(42),
    });
    expect(second).toEqual(first);
  });
});

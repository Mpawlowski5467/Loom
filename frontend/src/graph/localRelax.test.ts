import { describe, expect, it } from "vitest";
import { relaxNewNodes } from "./localRelax";
import type { XY } from "./orbitScenes";
import { measureLayoutFrame } from "./placement";

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A 5×5 lattice with 100-unit gaps, centered on the origin. */
function lattice(): Map<string, XY> {
  const out = new Map<string, XY>();
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      out.set(`g${i}${j}`, { x: (i - 2) * 100, y: (j - 2) * 100 });
    }
  }
  return out;
}

function adjacency(entries: Record<string, string[]>) {
  return (id: string): string[] => entries[id] ?? [];
}

describe("relaxNewNodes", () => {
  it("never writes the fixed layout", () => {
    const fixed = lattice();
    const before = new Map([...fixed].map(([id, p]) => [id, { ...p }]));
    const movable = new Map<string, XY>([["n", { x: 0, y: 0 }]]);
    relaxNewNodes(movable, adjacency({ n: ["g22"] }), fixed);
    expect(fixed).toEqual(before);
    expect([...movable.keys()]).toEqual(["n"]);
  });

  it("separates a node from its coincident neighbor to about one spacing", () => {
    const fixed = lattice();
    const spacing = measureLayoutFrame(fixed.values()).spacing;
    const movable = new Map<string, XY>([["n", { x: 0, y: 0 }]]);
    relaxNewNodes(movable, adjacency({ n: ["g22"] }), fixed);
    const d = dist(movable.get("n")!, fixed.get("g22")!);
    expect(d).toBeGreaterThan(spacing * 0.4);
    expect(d).toBeLessThan(spacing * 1.5);
  });

  it("pushes a node off an unrelated node it landed on", () => {
    const fixed = lattice();
    const movable = new Map<string, XY>([["n", { x: 100, y: 100 }]]);
    relaxNewNodes(movable, adjacency({}), fixed);
    let nearest = Infinity;
    for (const p of fixed.values()) {
      nearest = Math.min(nearest, dist(movable.get("n")!, p));
    }
    expect(nearest).toBeGreaterThan(20);
  });

  it("splits two new nodes that start on the same point", () => {
    const fixed = lattice();
    const movable = new Map<string, XY>([
      ["n1", { x: 50, y: 50 }],
      ["n2", { x: 50, y: 50 }],
    ]);
    relaxNewNodes(movable, adjacency({ n1: ["n2"], n2: ["n1"] }), fixed);
    expect(dist(movable.get("n1")!, movable.get("n2")!)).toBeGreaterThan(20);
  });

  it("holds a node linked to two far nodes at their midpoint", () => {
    const fixed = new Map<string, XY>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 1000, y: 0 }],
    ]);
    const movable = new Map<string, XY>([["n", { x: 500, y: 0 }]]);
    relaxNewNodes(movable, adjacency({ n: ["a", "b"] }), fixed);
    expect(movable.get("n")!.x).toBeCloseTo(500);
    expect(movable.get("n")!.y).toBeCloseTo(0);
  });

  it("is deterministic and finite", () => {
    const run = (): Map<string, XY> => {
      const movable = new Map<string, XY>([
        ["n1", { x: 0, y: 0 }],
        ["n2", { x: 0, y: 0 }],
        ["n3", { x: 210, y: -190 }],
      ]);
      relaxNewNodes(
        movable,
        adjacency({ n1: ["g22", "n2"], n2: ["n1"], n3: ["g44"] }),
        lattice(),
      );
      return movable;
    };
    const first = run();
    expect(run()).toEqual(first);
    for (const p of first.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it("does nothing without movable nodes", () => {
    const movable = new Map<string, XY>();
    relaxNewNodes(movable, adjacency({}), lattice());
    expect(movable.size).toBe(0);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import Graph from "graphology";
import { createBreathingTick } from "./breathing";
import type { GraphTuning } from "./tuning";

function mkTuning(sizeScale: number): GraphTuning {
  return {
    hovered: null,
    selected: null,
    isolateNeighbors: false,
    visibilityRestricted: false,
    dragging: false,
    filters: new Set(),
    palette: {
      edge: "",
      edgeHover: "",
      edgeFaint: "",
      label: "",
      nodeDimmed: "",
    },
    graphMode: "constellation",
    sizeScale,
    travelerPace: 1,
    labelsEnabled: true,
    labelShowRatio: 10,
    labelThreshold: 1,
    travelersEnabled: true,
    edgeThickness: 1,
    depthEnabled: false,
    cameraRatio: 1,
    labelTier: 1,
    lensLabelHideFor: null,
    degree: new Map(),
  };
}

function mkGraph(ids: string[]): Graph {
  const g = new Graph();
  for (const id of ids) g.addNode(id, { size: 0 });
  return g;
}

describe("createBreathingTick", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips frames that arrive within the throttle interval", () => {
    // Construction captures performance.now() as the start time.
    vi.stubGlobal("performance", { now: () => 0 });
    const g = mkGraph(["a"]);
    const tick = createBreathingTick(g, new Map([["a", 4]]), mkTuning(1));

    // First call past the 33ms interval mutates; an immediate follow-up skips.
    tick(40);
    const first = g.getNodeAttribute("a", "size");
    tick(50); // only 10ms later → throttled
    expect(g.getNodeAttribute("a", "size")).toBe(first);
    tick(90); // 50ms after the last applied frame
    expect(g.getNodeAttribute("a", "size")).not.toBe(first);
  });

  it("pulses node size within ±6% of base * scale", () => {
    vi.stubGlobal("performance", { now: () => 0 });
    const g = mkGraph(["a"]);
    const base = 5;
    const scale = 2;
    const tick = createBreathingTick(
      g,
      new Map([["a", base]]),
      mkTuning(scale),
    );

    // Sample across a full ~10s window to catch the sine extremes.
    let min = Infinity;
    let max = -Infinity;
    for (let now = 40; now <= 10_000; now += 40) {
      tick(now);
      const s = g.getNodeAttribute("a", "size") as number;
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    const center = base * scale; // 10
    expect(min).toBeGreaterThanOrEqual(center * 0.94 - 1e-6);
    expect(max).toBeLessThanOrEqual(center * 1.06 + 1e-6);
    // The pulse should actually move (not stuck at center).
    expect(max - min).toBeGreaterThan(0.5);
  });

  it("falls back to a base size of 4 for nodes missing from the map", () => {
    vi.stubGlobal("performance", { now: () => 0 });
    const g = mkGraph(["ghost"]);
    const tick = createBreathingTick(g, new Map(), mkTuning(1));
    tick(40);
    const s = g.getNodeAttribute("ghost", "size") as number;
    // 4 ± 6%.
    expect(s).toBeGreaterThanOrEqual(4 * 0.94 - 1e-6);
    expect(s).toBeLessThanOrEqual(4 * 1.06 + 1e-6);
  });

  it("gives nodes distinct phases so they do not pulse in lockstep", () => {
    vi.stubGlobal("performance", { now: () => 0 });
    const g = mkGraph(["alpha", "beta", "gamma"]);
    const sizes = new Map([
      ["alpha", 4],
      ["beta", 4],
      ["gamma", 4],
    ]);
    const tick = createBreathingTick(g, sizes, mkTuning(1));
    tick(40);
    const a = g.getNodeAttribute("alpha", "size") as number;
    const b = g.getNodeAttribute("beta", "size") as number;
    const c = g.getNodeAttribute("gamma", "size") as number;
    // Same base + same frame, but per-id phase offsets → different sizes.
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });

  it("tracks the live sizeScale from tuning", () => {
    vi.stubGlobal("performance", { now: () => 0 });
    const g = mkGraph(["a"]);
    const tuning = mkTuning(1);
    const tick = createBreathingTick(g, new Map([["a", 10]]), tuning);
    tick(40);
    const small = g.getNodeAttribute("a", "size") as number;

    tuning.sizeScale = 3; // user drags the node-size slider mid-animation
    tick(200);
    const large = g.getNodeAttribute("a", "size") as number;
    expect(large).toBeGreaterThan(small * 2);
  });

  it("pauses decorative work during a drag and skips filtered nodes", () => {
    vi.stubGlobal("performance", { now: () => 0 });
    const g = mkGraph(["visible", "filtered"]);
    g.setNodeAttribute("filtered", "hidden", true);
    const tuning = mkTuning(1);
    const tick = createBreathingTick(
      g,
      new Map([
        ["visible", 4],
        ["filtered", 4],
      ]),
      tuning,
    );

    tuning.dragging = true;
    tick(40);
    expect(g.getNodeAttribute("visible", "size")).toBe(0);

    tuning.dragging = false;
    tick(80);
    expect(g.getNodeAttribute("visible", "size")).not.toBe(0);
    expect(g.getNodeAttribute("filtered", "size")).toBe(0);
  });
});

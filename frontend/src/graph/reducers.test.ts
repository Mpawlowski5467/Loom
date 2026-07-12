import { describe, it, expect } from "vitest";
import Graph from "graphology";
import {
  spacingToCameraRatio,
  labelDegreeFloor,
  ratioToTier,
  computeEdgeExtremities,
  makeNodeReducer,
  makeEdgeReducer,
} from "./reducers";
import type { EdgePalette } from "./sigma-setup";
import type { GraphTuning } from "./tuning";

const PALETTE: EdgePalette = {
  edge: "edge",
  edgeHover: "edge-hover",
  edgeFaint: "edge-faint",
  label: "label",
  nodeDimmed: "node-dimmed",
};

/** A tuning object with neutral defaults; override fields per test. */
function mkTuning(overrides: Partial<GraphTuning> = {}): GraphTuning {
  return {
    hovered: null,
    selected: null,
    isolateNeighbors: false,
    visibilityRestricted: false,
    dragging: false,
    filters: new Set(),
    palette: PALETTE,
    graphMode: "constellation",
    sizeScale: 1,
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
    ...overrides,
  };
}

describe("spacingToCameraRatio", () => {
  it("inverts the spacing scale (tighter spacing = smaller ratio)", () => {
    expect(spacingToCameraRatio(1)).toBe(1);
    expect(spacingToCameraRatio(2)).toBe(0.5);
    expect(spacingToCameraRatio(0.5)).toBe(2);
  });
});

describe("ratioToTier", () => {
  it("buckets the camera ratio into four zoom tiers", () => {
    expect(ratioToTier(0.2)).toBe(0);
    expect(ratioToTier(0.7)).toBe(1);
    expect(ratioToTier(1.5)).toBe(2);
    expect(ratioToTier(5)).toBe(3);
  });

  it("places tier boundaries on the lower edge of each band", () => {
    // 0.4, 1.0, 2.0 each belong to the higher tier (strict < on the floor).
    expect(ratioToTier(0.4)).toBe(1);
    expect(ratioToTier(1.0)).toBe(2);
    expect(ratioToTier(2.0)).toBe(3);
  });
});

describe("labelDegreeFloor", () => {
  it("shows every label (floor 0) at the minimum knob", () => {
    expect(labelDegreeFloor(0.5, 1)).toBe(0);
  });

  it("hides every label (Infinity) at the maximum knob", () => {
    expect(labelDegreeFloor(0.5, 19)).toBe(Infinity);
    expect(labelDegreeFloor(0.5, 20)).toBe(Infinity);
  });

  it("raises the required degree as the knob climbs", () => {
    const low = labelDegreeFloor(1.0, 5);
    const high = labelDegreeFloor(1.0, 15);
    expect(high).toBeGreaterThan(low);
  });

  it("raises the required degree as the camera zooms out (higher ratio)", () => {
    // Same knob; a more zoomed-out view should demand higher degree to label.
    const zoomedIn = labelDegreeFloor(0.3, 12);
    const zoomedOut = labelDegreeFloor(3.0, 12);
    expect(zoomedOut).toBeGreaterThan(zoomedIn);
  });
});

describe("computeEdgeExtremities", () => {
  it("maps each edge to its [source, target] pair", () => {
    const g = new Graph();
    g.addNode("a");
    g.addNode("b");
    g.addNode("c");
    const e1 = g.addEdge("a", "b");
    const e2 = g.addEdge("b", "c");

    const ext = computeEdgeExtremities(g);
    expect(ext.get(e1)).toEqual(["a", "b"]);
    expect(ext.get(e2)).toEqual(["b", "c"]);
    expect(ext.size).toBe(2);
  });
});

describe("makeNodeReducer", () => {
  function mkGraph(): Graph {
    const g = new Graph();
    g.addNode("a", { noteType: "project" });
    g.addNode("b", { noteType: "topic" });
    g.addNode("c", { noteType: "topic" });
    g.addEdge("a", "b"); // a—b are neighbors; c is isolated
    return g;
  }

  it("hides nodes whose type is filtered out", () => {
    const g = mkGraph();
    const tuning = mkTuning({ filters: new Set(["project"]) });
    const reducer = makeNodeReducer(g, tuning);
    expect(reducer("b", { noteType: "topic", label: "B" }).hidden).toBe(true);
    expect(
      reducer("a", { noteType: "project", label: "A" }).hidden,
    ).toBeUndefined();
  });

  it("honors materialized neighborhood visibility", () => {
    const g = mkGraph();
    const reducer = makeNodeReducer(g, mkTuning());
    expect(
      reducer("c", { noteType: "topic", label: "C", hidden: true }).hidden,
    ).toBe(true);
  });

  it("keeps persistent selection emphasized after pointer hover ends", () => {
    const g = mkGraph();
    const tuning = mkTuning({ selected: "a", hovered: null });
    const reducer = makeNodeReducer(g, tuning);
    const selected = reducer("a", {
      noteType: "project",
      label: "A",
      size: 10,
    });
    expect(selected.label).toBe("A");
    expect(selected.forceLabel).toBe(true);
    expect(selected.highlighted).toBe(true);
    expect(selected.size).toBeCloseTo(12.8);
    expect(reducer("c", { noteType: "topic", label: "C" }).color).toBe(
      PALETTE.nodeDimmed,
    );
  });

  it("lets transient hover preview override persistent selection", () => {
    const g = mkGraph();
    const reducer = makeNodeReducer(
      g,
      mkTuning({ selected: "a", hovered: "b" }),
    );
    expect(
      reducer("b", { noteType: "topic", label: "B", size: 10 }).highlighted,
    ).toBeUndefined();
    expect(reducer("b", { noteType: "topic", label: "B" }).label).toBe("B");
  });

  it("keeps the hovered node's label and clears its neighbors' labels", () => {
    const g = mkGraph();
    const tuning = mkTuning({ hovered: "a" });
    const reducer = makeNodeReducer(g, tuning);
    expect(reducer("a", { noteType: "project", label: "A" }).label).toBe("A");
    // b is a neighbor of a → label cleared but not dimmed.
    const b = reducer("b", { noteType: "topic", label: "B" });
    expect(b.label).toBe("");
    expect(b.color).toBeUndefined();
  });

  it("dims and de-labels non-neighbors while hovering", () => {
    const g = mkGraph();
    const tuning = mkTuning({ hovered: "a" });
    const reducer = makeNodeReducer(g, tuning);
    const c = reducer("c", { noteType: "topic", label: "C" });
    expect(c.label).toBe("");
    expect(c.color).toBe(PALETTE.nodeDimmed);
  });

  it("clears the hovered node's own label when the lens covers it", () => {
    const g = mkGraph();
    const tuning = mkTuning({ hovered: "a", lensLabelHideFor: "a" });
    const reducer = makeNodeReducer(g, tuning);
    expect(reducer("a", { noteType: "project", label: "A" }).label).toBe("");
  });

  it("clears all labels when labels are disabled", () => {
    const g = mkGraph();
    const tuning = mkTuning({ labelsEnabled: false });
    const reducer = makeNodeReducer(g, tuning);
    expect(reducer("a", { noteType: "project", label: "A" }).label).toBe("");
  });

  it("clears labels once the camera is past the show-ratio", () => {
    const g = mkGraph();
    const tuning = mkTuning({ cameraRatio: 11, labelShowRatio: 10 });
    const reducer = makeNodeReducer(g, tuning);
    expect(reducer("a", { noteType: "project", label: "A" }).label).toBe("");
  });

  it("hides labels for nodes below the degree floor", () => {
    const g = mkGraph();
    // labelThreshold 10 + ratio 1.0 → a positive floor; degree map says a has 0.
    const tuning = mkTuning({
      cameraRatio: 1.0,
      labelShowRatio: 10,
      labelThreshold: 10,
      degree: new Map([["a", 0]]),
    });
    const reducer = makeNodeReducer(g, tuning);
    expect(reducer("a", { noteType: "project", label: "A" }).label).toBe("");
  });

  it("keeps labels for nodes at or above the degree floor", () => {
    const g = mkGraph();
    const tuning = mkTuning({
      cameraRatio: 1.0,
      labelShowRatio: 10,
      labelThreshold: 10,
      degree: new Map([["a", 99]]),
    });
    const reducer = makeNodeReducer(g, tuning);
    expect(reducer("a", { noteType: "project", label: "A" }).label).toBe("A");
  });

  describe("depth", () => {
    const deepNode = {
      noteType: "topic",
      label: "B",
      x: 100,
      y: 0,
      size: 8,
      z: 1,
      depthColor: "washed",
    };

    it("shrinks size and washes color on deep nodes (positions untouched)", () => {
      const g = mkGraph();
      const tuning = mkTuning({ depthEnabled: true });
      const reducer = makeNodeReducer(g, tuning);
      const out = reducer("b", { ...deepNode });
      expect(out.size).toBeLessThan(8);
      expect(out.color).toBe("washed");
      expect(out.x).toBe(100); // Sigma owns positions; the reducer must not.
      expect(out.label).toBe("B");
    });

    it("leaves nodes untouched when depth is disabled", () => {
      const g = mkGraph();
      const tuning = mkTuning({ depthEnabled: false });
      const reducer = makeNodeReducer(g, tuning);
      const out = reducer("b", { ...deepNode });
      expect(out.size).toBe(8);
      expect(out.color).toBeUndefined();
      expect(out.x).toBe(100);
    });

    it("pops the hovered node onto the focus plane (no shrink or wash)", () => {
      const g = mkGraph();
      const tuning = mkTuning({ depthEnabled: true, hovered: "b" });
      const reducer = makeNodeReducer(g, tuning);
      const out = reducer("b", { ...deepNode });
      expect(out.size).toBe(8);
      expect(out.color).toBeUndefined();
      expect(out.label).toBe("B");
    });

    it("still dims hovered non-neighbors over their depth wash", () => {
      const g = mkGraph();
      const tuning = mkTuning({ depthEnabled: true, hovered: "a" });
      const reducer = makeNodeReducer(g, tuning);
      // c is not a neighbor of a → the hover dim wins over depthColor.
      const out = reducer("c", { ...deepNode });
      expect(out.color).toBe(PALETTE.nodeDimmed);
      expect(out.label).toBe("");
    });
  });
});

describe("makeEdgeReducer", () => {
  function setup() {
    const g = new Graph();
    g.addNode("a");
    g.addNode("b");
    g.addNode("c");
    const hit = g.addEdge("a", "b"); // touches the hovered node
    const miss = g.addEdge("b", "c"); // does not
    const ext = computeEdgeExtremities(g);
    return { g, hit, miss, ext };
  }

  it("scales edge size by the thickness knob when nothing is hovered", () => {
    const { g, hit, ext } = setup();
    const tuning = mkTuning({ hovered: null, edgeThickness: 3 });
    const reducer = makeEdgeReducer(g, tuning, ext);
    expect(reducer(hit, { size: 2 }).size).toBe(6);
  });

  it("defaults missing edge size to 1 before scaling", () => {
    const { g, hit, ext } = setup();
    const tuning = mkTuning({ hovered: null, edgeThickness: 2 });
    const reducer = makeEdgeReducer(g, tuning, ext);
    expect(reducer(hit, {}).size).toBe(2);
  });

  it("highlights edges touching the hovered node", () => {
    const { g, hit, ext } = setup();
    const tuning = mkTuning({ hovered: "a", edgeThickness: 2 });
    const reducer = makeEdgeReducer(g, tuning, ext);
    const out = reducer(hit, { size: 1 });
    expect(out.color).toBe(PALETTE.edgeHover);
    expect(out.size).toBe(2.8); // 1.4 * thickness
  });

  it("highlights edges touching the persistently selected node", () => {
    const { g, hit, miss, ext } = setup();
    const reducer = makeEdgeReducer(
      g,
      mkTuning({ selected: "a", edgeThickness: 1 }),
      ext,
    );
    expect(reducer(hit, { size: 1 }).color).toBe(PALETTE.edgeHover);
    expect(reducer(miss, { size: 1 }).color).toBe(PALETTE.edgeFaint);
  });

  it("faints edges that do not touch the hovered node", () => {
    const { g, miss, ext } = setup();
    const tuning = mkTuning({ hovered: "a", edgeThickness: 1 });
    const reducer = makeEdgeReducer(g, tuning, ext);
    const out = reducer(miss, { size: 1 });
    expect(out.color).toBe(PALETTE.edgeFaint);
  });

  it("falls back to graph.extremities when the edge is absent from the map", () => {
    const { g } = setup();
    const tuning = mkTuning({ hovered: "a", edgeThickness: 1 });
    // Empty extremities map forces the graph.extremities() fallback path.
    const reducer = makeEdgeReducer(g, tuning, new Map());
    const e = g.edges("a", "b")[0]!;
    expect(reducer(e, { size: 1 }).color).toBe(PALETTE.edgeHover);
  });

  describe("depth fade", () => {
    it("fades edges by the average depth of their endpoints", () => {
      const { g, hit, ext } = setup();
      const tuning = mkTuning({
        depthEnabled: true,
        palette: { ...PALETTE, edge: "rgba(26,24,21,0.18)" },
      });
      const nodeZ = new Map([
        ["a", 1],
        ["b", 1],
      ]);
      const reducer = makeEdgeReducer(g, tuning, ext, nodeZ);
      const out = reducer(hit, { size: 1 });
      // avg z = 1 → alpha scaled by (1 - DEPTH_EDGE_FADE) = 0.45.
      expect(out.color).toBe("rgba(26,24,21,0.081)");
      expect(out.size).toBe(1);
    });

    it("does not fade focus-plane edges or when depth is off", () => {
      const { g, hit, ext } = setup();
      const zZero = new Map([
        ["a", 0],
        ["b", 0],
      ]);
      const on = makeEdgeReducer(
        g,
        mkTuning({ depthEnabled: true }),
        ext,
        zZero,
      );
      expect(on(hit, { size: 1 }).color).toBeUndefined();
      const off = makeEdgeReducer(
        g,
        mkTuning({ depthEnabled: false }),
        ext,
        new Map([
          ["a", 1],
          ["b", 1],
        ]),
      );
      expect(off(hit, { size: 1 }).color).toBeUndefined();
    });

    it("hover styling wins over the depth fade", () => {
      const { g, hit, ext } = setup();
      const tuning = mkTuning({ depthEnabled: true, hovered: "a" });
      const nodeZ = new Map([
        ["a", 1],
        ["b", 1],
      ]);
      const reducer = makeEdgeReducer(g, tuning, ext, nodeZ);
      expect(reducer(hit, { size: 1 }).color).toBe(PALETTE.edgeHover);
    });
  });
});

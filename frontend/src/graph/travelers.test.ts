/*
Smoke tests for the edge-travelers overlay: construction builds the SVG DOM,
tick mutates it without throwing, and destroy removes every trace. The canvas
math itself (dash phase, disk trim) is covered indirectly through the DOM
attributes tick writes.
*/
import { afterEach, describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import { createTravelers } from "./travelers";
import type { GraphTuning } from "./tuning";
import type { XY } from "./layouts";

function stubSigma(ratio = 1): Sigma {
  return {
    getCamera: () => ({ ratio }),
    graphToViewport: (p: XY) => p,
  } as unknown as Sigma;
}

function makeTuning(overrides: Partial<GraphTuning> = {}): GraphTuning {
  return {
    hovered: null,
    selected: null,
    isolateNeighbors: false,
    visibilityRestricted: false,
    dragging: false,
    filters: new Set(),
    palette: {
      edge: "#000",
      edgeHover: "#000",
      edgeFaint: "#000",
      label: "#000",
      nodeDimmed: "#000",
    },
    graphMode: "constellation",
    sizeScale: 1,
    travelerPace: 1,
    labelsEnabled: true,
    labelShowRatio: 0.55,
    labelThreshold: 7,
    travelersEnabled: true,
    edgeThickness: 1,
    depthEnabled: true,
    cameraRatio: 1,
    labelTier: 0,
    lensLabelHideFor: null,
    degree: new Map(),
    ...overrides,
  };
}

function makeGraph(): Graph {
  const graph = new Graph();
  graph.addNode("a", { x: 0, y: 0, size: 4, z: 0 });
  graph.addNode("b", { x: 60, y: 0, size: 4, z: 0 });
  graph.addEdge("a", "b");
  return graph;
}

function makeOverlay(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

describe("createTravelers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds one line per edge plus a node mask, and destroy removes them", () => {
    const overlay = makeOverlay();
    const travelers = createTravelers({
      overlay,
      graph: makeGraph(),
      sigma: stubSigma(),
      tuning: makeTuning(),
    });

    // defs (node mask) + the traveler group land in the overlay.
    expect(overlay.childNodes.length).toBe(2);
    expect(overlay.querySelectorAll("line")).toHaveLength(1);
    expect(overlay.querySelectorAll("mask circle")).toHaveLength(2);

    travelers.destroy();

    expect(overlay.childNodes.length).toBe(0);
    expect(overlay.querySelector("line")).toBeNull();
  });

  it("tick writes line/mask attributes without throwing and never requests a repaint", () => {
    const overlay = makeOverlay();
    const travelers = createTravelers({
      overlay,
      graph: makeGraph(),
      sigma: stubSigma(),
      tuning: makeTuning(),
    });

    let needsRefresh = true;
    expect(() => {
      needsRefresh = travelers.tick(0);
      travelers.tick(16);
    }).not.toThrow();
    // Travelers only mutate overlay DOM — Sigma never needs a refresh.
    expect(needsRefresh).toBe(false);

    const line = overlay.querySelector("line")!;
    expect(line.getAttribute("x1")).not.toBeNull();
    expect(line.getAttribute("x2")).not.toBeNull();
    const maskCircle = overlay.querySelector("mask circle")!;
    expect(maskCircle.getAttribute("cx")).not.toBeNull();
    expect(Number(maskCircle.getAttribute("r"))).toBeGreaterThan(0);

    travelers.destroy();
  });

  it("hides all lines while dragging and registers no event listeners", () => {
    const addSpy = vi.spyOn(EventTarget.prototype, "addEventListener");
    const overlay = makeOverlay();
    const travelers = createTravelers({
      overlay,
      graph: makeGraph(),
      sigma: stubSigma(),
      tuning: makeTuning({ dragging: true }),
    });

    expect(travelers.tick(0)).toBe(false);
    expect(overlay.querySelector("line")!.getAttribute("opacity")).toBe("0");
    // The overlay is purely passive DOM — it must not subscribe to anything.
    expect(addSpy).not.toHaveBeenCalled();

    travelers.destroy();
  });
});

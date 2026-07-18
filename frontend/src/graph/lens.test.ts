/*
Smoke tests for the reading-lens overlay: construction builds the SVG DOM,
ticks drive the open/close easing without throwing, and destroy removes the
DOM and the one click listener it registered. jsdom provides the SVG surface;
the Sigma stub pins the camera ratio so the lens's zoom gate is deterministic.
*/
import { afterEach, describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import type { Note, NoteId } from "../data/types";
import { createLens } from "./lens";
import type { GraphTuning } from "./tuning";
import type { XY } from "./layouts";

function stubSigma(ratio = 1): Sigma {
  return {
    getCamera: () => ({ ratio }),
    graphToViewport: (p: XY) => p,
    viewportToGraph: (p: XY) => p,
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
  graph.addNode("a", { x: 0, y: 0, size: 4, z: 0, color: "#123" });
  graph.addNode("b", { x: 60, y: 0, size: 4, z: 0, color: "#123" });
  graph.addEdge("a", "b");
  return graph;
}

function note(id: string): Note {
  return {
    id: id as NoteId,
    title: `Title ${id}`,
    type: "topic",
    body: "A lead line.\n\n## First Section\n\nBody text.\n",
  } as unknown as Note;
}

function makeOverlay(): SVGSVGElement {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
}

describe("createLens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds its SVG DOM hidden, and destroy removes the DOM + click listener", () => {
    const addSpy = vi.spyOn(EventTarget.prototype, "addEventListener");
    const removeSpy = vi.spyOn(EventTarget.prototype, "removeEventListener");
    const overlay = makeOverlay();
    const tuning = makeTuning({ lensLabelHideFor: "a" });
    const lens = createLens({
      overlay,
      graph: makeGraph(),
      sigma: stubSigma(),
      host: document.createElement("div"),
      noteMap: new Map([["a", note("a")]]),
      tuning,
      openNote: vi.fn(),
    });

    // defs (clip path) + the lens group; starts hidden.
    expect(overlay.childNodes.length).toBe(2);
    expect(overlay.querySelector("g")!.getAttribute("display")).toBe("none");

    // Exactly one listener registered (the hit-rect click)…
    const clickAdds = addSpy.mock.calls.filter((c) => c[0] === "click");
    expect(clickAdds).toHaveLength(1);

    lens.destroy();

    // …removed with the identical handler on destroy, DOM gone, label-hide
    // state released so no reducer keeps hiding a label for a dead lens.
    const clickRemoves = removeSpy.mock.calls.filter((c) => c[0] === "click");
    expect(clickRemoves).toHaveLength(1);
    expect(clickRemoves[0]![1]).toBe(clickAdds[0]![1]);
    expect(overlay.childNodes.length).toBe(0);
    expect(tuning.lensLabelHideFor).toBeNull();
  });

  it("ticks without throwing and stays hidden while zoomed out", () => {
    const overlay = makeOverlay();
    const lens = createLens({
      overlay,
      graph: makeGraph(),
      sigma: stubSigma(1), // ratio 1 → zoom gate closed
      host: document.createElement("div"),
      noteMap: new Map([["a", note("a")]]),
      tuning: makeTuning(),
      openNote: vi.fn(),
    });

    expect(() => {
      for (let i = 0; i < 8; i++) lens.tick(i * 16);
    }).not.toThrow();
    expect(overlay.querySelector("g")!.getAttribute("display")).toBe("none");

    lens.destroy();
  });

  it("opens around the nearest node when zoomed in, populating the preview", () => {
    const overlay = makeOverlay();
    const lens = createLens({
      overlay,
      graph: makeGraph(),
      sigma: stubSigma(0.5), // ratio 0.5 → zoomOpenness 0.5
      host: document.createElement("div"),
      noteMap: new Map([["a", note("a")], ["b", note("b")]]),
      tuning: makeTuning(),
      openNote: vi.fn(),
    });

    expect(() => {
      for (let i = 0; i < 8; i++) lens.tick(i * 16);
    }).not.toThrow();

    // Lens visible…
    expect(overlay.querySelector("g")!.getAttribute("display")).toBe("");
    // …with the note's title populated into the preview card.
    expect(overlay.textContent).toContain("Title a");

    lens.destroy();
    expect(overlay.childNodes.length).toBe(0);
  });
});

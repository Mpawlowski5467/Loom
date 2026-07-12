import { renderHook } from "@testing-library/react";
import Graph from "graphology";
import type Sigma from "sigma";
import { describe, expect, it, vi } from "vitest";
import { GRAPH_DISPLAY_DEFAULTS, type GraphDisplay } from "../context/app-ctx";
import type { NodeType } from "../data/types";
import type { GraphTuning } from "./tuning";
import { useGraphDisplaySync } from "./useGraphDisplaySync";

vi.mock("./sigma-setup", () => ({
  applyPaletteToGraph: vi.fn(),
}));

function ref<T>(current: T): { current: T } {
  return { current };
}

function makeSigma() {
  const animate = vi.fn();
  const sigma = {
    refresh: vi.fn(),
    setSetting: vi.fn(),
    setCustomBBox: vi.fn(),
    getCamera: () => ({ animate }),
  } as unknown as Sigma;
  return { sigma, animate };
}

function makeTuning(): GraphTuning {
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
    sizeScale: 1,
    travelerPace: 1,
    labelsEnabled: true,
    labelShowRatio: 1,
    labelThreshold: 7,
    travelersEnabled: true,
    edgeThickness: 1,
    depthEnabled: true,
    cameraRatio: 1,
    labelTier: 0,
    lensLabelHideFor: null,
    degree: new Map(),
  };
}

describe("useGraphDisplaySync — filters", () => {
  it("fits the visible subset and restores labels below the visible-node budget", () => {
    const graph = new Graph();
    graph.addNode("focus", {
      x: 0,
      y: 0,
      size: 4,
      noteType: "topic",
    });
    for (let index = 0; index < 500; index += 1) {
      graph.addNode(`project-${index}`, {
        x: index + 10,
        y: index % 10,
        size: 4,
        noteType: "project",
      });
    }
    graph.addEdge("focus", "project-0");

    const { sigma, animate } = makeSigma();
    const tuningRef = ref(makeTuning());
    const stopDrag = vi.fn();
    const args = {
      sigmaRef: ref<Sigma | null>(sigma),
      graphRef: ref<Graph | null>(graph),
      baseSizesRef: ref(new Map(graph.nodes().map((id) => [id, 4] as const))),
      spacingScaleRef: ref(1),
      tuningRef,
      graphDisplay: { ...GRAPH_DISPLAY_DEFAULTS } satisfies GraphDisplay,
      graphMode: "constellation" as const,
      theme: "paper" as const,
      sigmaReady: 1,
      stopDragSimRef: ref<(() => void) | null>(stopDrag),
    };

    const { rerender } = renderHook(
      ({
        filters,
        selected,
        isolate,
      }: {
        filters: Set<NodeType>;
        selected: string | null;
        isolate: boolean;
      }) =>
        useGraphDisplaySync({
          ...args,
          graphFilters: filters,
          selectedNodeId: selected,
          isolateNeighbors: isolate,
        }),
      {
        initialProps: {
          filters: new Set<NodeType>(),
          selected: null,
          isolate: false,
        },
      },
    );

    expect(sigma.setSetting).toHaveBeenCalledWith("renderLabels", false);
    expect(sigma.setCustomBBox).toHaveBeenCalledWith(null);

    rerender({
      filters: new Set<NodeType>(["topic"]),
      selected: null,
      isolate: false,
    });

    expect(graph.getNodeAttribute("focus", "hidden")).toBe(false);
    expect(graph.getNodeAttribute("project-0", "hidden")).toBe(true);
    expect(sigma.setSetting).toHaveBeenLastCalledWith("renderLabels", true);
    expect(sigma.setCustomBBox).toHaveBeenLastCalledWith({
      x: [-1, 1],
      y: [-1, 1],
    });
    expect(animate).toHaveBeenLastCalledWith(
      { ratio: 1, x: 0.5, y: 0.5 },
      expect.objectContaining({ duration: 450 }),
    );
    expect(stopDrag).toHaveBeenCalled();

    rerender({
      filters: new Set<NodeType>(),
      selected: "focus",
      isolate: true,
    });
    expect(tuningRef.current.selected).toBe("focus");
    expect(tuningRef.current.isolateNeighbors).toBe(true);
    expect(tuningRef.current.visibilityRestricted).toBe(true);
    expect(graph.getNodeAttribute("focus", "hidden")).toBe(false);
    expect(graph.getNodeAttribute("project-0", "hidden")).toBe(false);
    expect(graph.getNodeAttribute("project-1", "hidden")).toBe(true);
    expect(sigma.setCustomBBox).toHaveBeenLastCalledWith({
      x: [-0.5, 10.5],
      y: [-0.5, 0.5],
    });
  });
});

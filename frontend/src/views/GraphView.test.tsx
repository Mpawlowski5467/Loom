import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Graph from "graphology";
import type { ReactNode } from "react";
import type Sigma from "sigma";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AppCtx,
  type AppContextValue,
  GRAPH_DISPLAY_DEFAULTS,
} from "../context/app-ctx";
import { GraphView } from "./GraphView";
import type { GraphLayout, Note, NodeType } from "../data/types";

// The graph is driven by Sigma through three hooks; GraphView's own job is the
// overlay chrome (empty / loading / stats / scene caption). Mock the hooks so
// no real Sigma instance or canvas is needed.
const { mockInstance } = vi.hoisted(() => ({
  mockInstance: {
    building: false,
    sigmaReady: true,
    scene: "rings" as "rings" | "spiral" | "arms",
  },
}));

let runtimeSigma: Sigma | null = null;
let runtimeGraph: Graph | null = null;
let runtimeActiveTween: { cancel: () => void } | null = null;
let runtimeStopDragSim: (() => void) | null = null;
let runtimeOrbitTargets = new Map<string, { x: number; y: number }>();

function refs() {
  // useGraphInstance returns a bag of refs + two booleans. The refs are only
  // dereferenced inside effects that the mocked hooks replace, so empty refs
  // are fine; GraphView itself reads .current in effects guarded by null checks.
  const r = { current: null };
  return {
    sigmaRef: { current: runtimeSigma },
    graphRef: { current: runtimeGraph },
    frameLoopRef: r,
    baseSizesRef: { current: new Map() },
    basePositionsRef: { current: new Map() },
    orbitTargetsRef: { current: runtimeOrbitTargets },
    activeTweenRef: { current: runtimeActiveTween },
    breathingRemoveRef: r,
    stopDragSimRef: { current: runtimeStopDragSim },
    sigmaReady: mockInstance.sigmaReady,
    building: mockInstance.building,
  };
}

vi.mock("../graph/useGraphInstance", () => ({
  PERF_BUDGET_NODES: 500,
  useGraphInstance: () => refs(),
}));
vi.mock("../graph/useGraphScene", () => ({
  useGraphScene: () => mockInstance.scene,
}));
vi.mock("../graph/useGraphDisplaySync", () => ({
  useGraphDisplaySync: () => {},
}));
// sigma-setup transitively loads Sigma, which touches WebGL at module scope
// (undefined in jsdom). GraphView only uses readEdgePalette from it.
vi.mock("../graph/sigma-setup", () => ({
  readEdgePalette: () => ({
    edge: "",
    edgeHover: "",
    edgeFaint: "",
    label: "",
    nodeDimmed: "",
  }),
}));
// The export helpers import Sigma types only; stub to avoid the WebGL load.
vi.mock("../graph/export", () => ({
  exportGraphPng: vi.fn(),
  exportGraphSvg: vi.fn(),
  exportGraphJson: vi.fn(),
}));

function mkNote(id: string, links: string[] = []): Note {
  return {
    id,
    title: id,
    type: "topic",
    folder: "topics",
    tags: [],
    body: "",
    links,
    history: [],
    created: "2026-05-01T00:00:00Z",
    modified: "2026-05-01T00:00:00Z",
    status: "active",
    source: "manual",
  };
}

function renderGraph(
  notes: Note[],
  layout: GraphLayout = "force",
  notesLoaded = true,
  graphFilters: Set<NodeType> = new Set(),
  graphSelectedId: string | null = null,
) {
  const openNote = vi.fn();
  const setGraphSelectedId = vi.fn();
  const value = {
    notes,
    notesLoaded,
    openNote,
    graphFocusId: null,
    setGraphFocusId: vi.fn(),
    graphSelectedId,
    setGraphSelectedId,
    graphFlyTo: null,
    graphFilters,
    toggleGraphFilter: vi.fn(),
    clearGraphFilters: vi.fn(),
    graphDisplay: { ...GRAPH_DISPLAY_DEFAULTS, layout },
    theme: "paper",
    pushToast: vi.fn(),
  } as unknown as AppContextValue;

  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <GraphView />
      </AppCtx.Provider>
    );
  }
  return { ...render(<Harness />), openNote, setGraphSelectedId };
}

beforeEach(() => {
  mockInstance.building = false;
  mockInstance.sigmaReady = true;
  mockInstance.scene = "rings";
  runtimeSigma = null;
  runtimeGraph = null;
  runtimeActiveTween = null;
  runtimeStopDragSim = null;
  runtimeOrbitTargets = new Map();
});

describe("GraphView", () => {
  it("shows the empty-graph prompt when there are no notes", () => {
    renderGraph([]);
    expect(screen.getByText(/Your graph is empty/)).toBeInTheDocument();
    // No stats line for an empty graph.
    expect(screen.queryByText(/nodes ·/)).not.toBeInTheDocument();
  });

  it("shows a loading state instead of the empty prompt during the initial fetch", () => {
    renderGraph([], "force", false);
    expect(screen.getByText(/loading your vault/)).toBeInTheDocument();
    // Must NOT flash "empty" before the load settles.
    expect(screen.queryByText(/Your graph is empty/)).not.toBeInTheDocument();
  });

  it("renders the node and edge counts", () => {
    renderGraph([mkNote("a", ["b"]), mkNote("b", ["a"]), mkNote("c")]);
    // Reciprocal note links collapse into one undirected visual edge.
    expect(screen.getByText(/3 nodes · 1 edge/)).toBeInTheDocument();
  });

  it("reports counts for the visible induced subgraph", () => {
    const project = { ...mkNote("p", ["t"]), type: "project" as const };
    const topic = mkNote("t", ["p"]);
    renderGraph([project, topic], "force", true, new Set(["project"]));
    expect(screen.getByText(/1 of 2 nodes · 0 edges/)).toBeInTheDocument();
  });

  it("offers to clear filters when no notes match", () => {
    renderGraph([mkNote("t")], "force", true, new Set(["project"]));
    const emptyState = screen.getByRole("status");
    expect(emptyState).toHaveTextContent("No notes match these filters.");
    expect(
      within(emptyState).getByRole("button", { name: "Clear filters" }),
    ).toBeInTheDocument();
  });

  it("shows the building loader while the layout is arranging", () => {
    mockInstance.building = true;
    renderGraph([mkNote("a"), mkNote("b")]);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/arranging 2 nodes/);
  });

  it("does not show the loader once the build settles", () => {
    mockInstance.building = false;
    renderGraph([mkNote("a")]);
    expect(screen.queryByText(/arranging/)).not.toBeInTheDocument();
  });

  it("shows the layout caption for a scene layout", () => {
    mockInstance.scene = "spiral";
    renderGraph([mkNote("a"), mkNote("b")], "spiral");
    expect(screen.getByText("Layout")).toBeInTheDocument();
    expect(screen.getByText("Spiral")).toBeInTheDocument();
  });

  it("hides the layout caption for the force layout", () => {
    renderGraph([mkNote("a")], "force");
    expect(screen.queryByText("Layout")).not.toBeInTheDocument();
  });

  it("flags paused animations for a graph past the perf budget", () => {
    const many = Array.from({ length: 501 }, (_, i) => mkNote(`n${i}`));
    renderGraph(many);
    expect(screen.getByText(/animations paused/)).toBeInTheDocument();
  });

  it("does not flag the perf note for a small graph", () => {
    renderGraph([mkNote("a"), mkNote("b")]);
    expect(screen.queryByText(/animations paused/)).not.toBeInTheDocument();
  });

  it("shows persistent details and visible direct-connection count", () => {
    const selected = {
      ...mkNote("a", ["b"]),
      title: "Caching",
      tags: ["systems"],
    };
    renderGraph(
      [selected, mkNote("b"), mkNote("in", ["a"]), mkNote("far")],
      "force",
      true,
      new Set(),
      "a",
    );

    const card = screen.getByRole("complementary", {
      name: "Node details: Caching",
    });
    expect(card).toHaveTextContent("2 connections");
    expect(card).toHaveTextContent("#systems");
  });

  it("wires selected-node open, clear, and Escape actions", async () => {
    const user = userEvent.setup();
    const { openNote, setGraphSelectedId } = renderGraph(
      [mkNote("a")],
      "force",
      true,
      new Set(),
      "a",
    );

    await user.click(screen.getByRole("button", { name: "Open note" }));
    expect(openNote).toHaveBeenCalledWith("a");

    const graph = screen.getByRole("application", { name: "Knowledge graph" });
    graph.focus();
    await user.keyboard("{Escape}");
    expect(setGraphSelectedId).toHaveBeenCalledWith(null);
  });

  it("returns focus to the graph when the selection card is cleared", async () => {
    const user = userEvent.setup();
    const { setGraphSelectedId } = renderGraph(
      [mkNote("a")],
      "force",
      true,
      new Set(),
      "a",
    );

    await user.click(
      screen.getByRole("button", { name: "Clear node selection" }),
    );

    expect(
      screen.getByRole("application", { name: "Knowledge graph" }),
    ).toHaveFocus();
    expect(setGraphSelectedId).toHaveBeenCalledWith(null);
  });

  it("centers the camera directly in orbit mode", async () => {
    const user = userEvent.setup();
    runtimeGraph = new Graph();
    runtimeGraph.addNode("a", { x: 0, y: 0 });
    const animate = vi.fn();
    runtimeSigma = {
      getCamera: () => ({ animate }),
      getNodeDisplayData: () => ({ x: 0.2, y: 0.8 }),
    } as unknown as Sigma;

    renderGraph([mkNote("a")], "rings", true, new Set(), "a");
    await user.click(screen.getByRole("button", { name: "Center" }));

    expect(animate).toHaveBeenCalledWith(
      { x: 0.2, y: 0.8, ratio: 0.45 },
      expect.objectContaining({ duration: 500 }),
    );
  });

  it("settles active motion before fitting the visible graph", async () => {
    const user = userEvent.setup();
    runtimeGraph = new Graph();
    runtimeGraph.addNode("a", { x: 100, y: 100 });
    runtimeGraph.addNode("b", { x: 200, y: 200 });
    runtimeGraph.addNode("hidden", { x: 9_999, y: 9_999, hidden: true });
    const animate = vi.fn();
    const setCustomBBox = vi.fn();
    const refresh = vi.fn();
    runtimeSigma = {
      getCamera: () => ({ animate }),
      setCustomBBox,
      refresh,
    } as unknown as Sigma;
    const cancel = vi.fn();
    runtimeActiveTween = { cancel };
    runtimeStopDragSim = vi.fn();
    runtimeOrbitTargets = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 10, y: 20 }],
    ]);

    renderGraph([mkNote("a"), mkNote("b")], "rings");
    await user.click(screen.getByRole("button", { name: "Fit visible nodes" }));

    expect(runtimeStopDragSim).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(runtimeGraph.getNodeAttributes("a")).toMatchObject({ x: 0, y: 0 });
    expect(runtimeGraph.getNodeAttributes("b")).toMatchObject({ x: 10, y: 20 });
    expect(setCustomBBox).toHaveBeenLastCalledWith({
      x: [-0.5, 10.5],
      y: [-1, 21],
    });
    expect(refresh).toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.5, y: 0.5 }),
      expect.objectContaining({ duration: 450 }),
    );
  });

  it("narrows stats to the selected one-hop neighborhood", async () => {
    const user = userEvent.setup();
    renderGraph(
      [mkNote("a", ["b"]), mkNote("b", ["far"]), mkNote("far")],
      "force",
      true,
      new Set(),
      "a",
    );

    await user.click(
      screen.getByRole("switch", {
        name: "Show selected note and direct neighbors only",
      }),
    );
    expect(screen.getByText(/2 of 3 nodes · 1 edge/)).toBeInTheDocument();
    expect(screen.getByText(/neighborhood focus/)).toBeInTheDocument();
  });

  it("clears a selection hidden by the active type filter", () => {
    const project = { ...mkNote("p"), type: "project" as const };
    const { setGraphSelectedId } = renderGraph(
      [project, mkNote("t")],
      "force",
      true,
      new Set(["topic"]),
      "p",
    );
    expect(setGraphSelectedId).toHaveBeenCalledWith(null);
  });
});

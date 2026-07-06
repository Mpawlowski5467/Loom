import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue, GRAPH_DISPLAY_DEFAULTS } from "../context/app-ctx";
import { GraphView } from "./GraphView";
import type { GraphLayout, Note } from "../data/types";

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

function refs() {
  // useGraphInstance returns a bag of refs + two booleans. The refs are only
  // dereferenced inside effects that the mocked hooks replace, so empty refs
  // are fine; GraphView itself reads .current in effects guarded by null checks.
  const r = { current: null };
  return {
    sigmaRef: r,
    graphRef: r,
    frameLoopRef: r,
    baseSizesRef: { current: new Map() },
    basePositionsRef: { current: new Map() },
    orbitTargetsRef: { current: new Map() },
    activeTweenRef: r,
    breathingRemoveRef: r,
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
) {
  const value = {
    notes,
    notesLoaded,
    openNote: vi.fn(),
    graphFocusId: null,
    setGraphFocusId: vi.fn(),
    graphFlyTo: null,
    graphFilters: new Set<string>(),
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
  return render(<Harness />);
}

beforeEach(() => {
  mockInstance.building = false;
  mockInstance.sigmaReady = true;
  mockInstance.scene = "rings";
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
    // 3 nodes, 2 edges (a→b, b→a).
    expect(screen.getByText(/3 nodes · 2 edges/)).toBeInTheDocument();
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
});

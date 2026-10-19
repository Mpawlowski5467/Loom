import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Graph from "graphology";
import type { ReactNode } from "react";
import type Sigma from "sigma";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppCtx,
  type AppContextValue,
  GRAPH_DISPLAY_DEFAULTS,
} from "../context/app-ctx";
import type { GraphLayout, Note } from "../data/types";
import { detectCommunities } from "../graph/communities";
import { DEFAULT_NODE_FILTER, type GraphNodeFilter } from "../graph/nodeFilter";
import { TestAppearanceProvider } from "../test/appearance";
import { GraphView } from "./GraphView";

// The graph is driven by Sigma through three hooks; GraphView's own job is the
// layout and chrome (sidebar, toolbar, overlays, panel). Mock the hooks so no
// real Sigma instance or canvas is needed.
const { mockInstance } = vi.hoisted(() => ({
  mockInstance: {
    building: false,
    sigmaReady: 1,
    scene: "rings" as "rings" | "spiral" | "arms",
  },
}));

let runtimeSigma: Sigma | null = null;
let runtimeGraph: Graph | null = null;
let runtimeActiveTween: { cancel: () => void } | null = null;
let runtimeStopDragSim: (() => void) | null = null;
let runtimeOrbitTargets = new Map<string, { x: number; y: number }>();

function refs() {
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
    structureVersion: 0,
    building: mockInstance.building,
  };
}

vi.mock("@/theme/useThemeColors", () => ({
  useThemeColors: () => ({
    key: "graphite|theme|theme",
    background: "#09090b",
    foreground: "#fafafa",
    secondaryForeground: "#d4d4d8",
    mutedForeground: "#a1a1aa",
    border: "#27272a",
    borderStrong: "#3f3f46",
    brand: "#60a5fa",
    community: ["#60a5fa", "#f59e0b", "#2dd4bf", "#a78bfa"],
  }),
}));
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
// sigma-setup transitively loads Sigma, which touches WebGL at module scope.
vi.mock("../graph/sigma-setup", () => ({
  readEdgePalette: () => ({
    edge: "",
    edgeHover: "",
    edgeFaint: "",
    label: "",
    nodeDimmed: "",
  }),
}));
vi.mock("../graph/export", () => ({
  exportGraphPng: vi.fn(),
  exportGraphSvg: vi.fn(),
  exportGraphJson: vi.fn(),
}));
// The panel has its own tests; here it only has to open and close.
vi.mock("./graph/panel/GraphNotePanel", () => ({
  GraphNotePanel: ({ note, onClose }: { note: Note; onClose: () => void }) => (
    <aside aria-label="Open note">
      {note.title}
      <button type="button" onClick={onClose}>
        Close note
      </button>
    </aside>
  ),
}));

function mkNote(id: string, links: string[] = [], folder = "topics"): Note {
  return {
    id,
    title: id,
    type: "topic",
    folder,
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

interface Options {
  layout?: GraphLayout;
  notesLoaded?: boolean;
  filter?: Partial<GraphNodeFilter>;
  selected?: string | null;
  notesError?: string | null;
}

function renderGraph(notes: Note[], o: Options = {}) {
  const value = {
    notes,
    notesLoaded: o.notesLoaded ?? true,
    notesError: o.notesError ?? null,
    openNote: vi.fn(),
    flyToNode: vi.fn(),
    config: { active_vault: "demo" },
    graphFocusId: null,
    setGraphFocusId: vi.fn(),
    graphSelectedId: o.selected ?? null,
    setGraphSelectedId: vi.fn(),
    graphFlyTo: null,
    graphFilter: { ...DEFAULT_NODE_FILTER, ...o.filter },
    setGraphFilter: vi.fn(),
    resetGraphFilter: vi.fn(),
    communities: detectCommunities(notes),
    graphDisplay: { ...GRAPH_DISPLAY_DEFAULTS, layout: o.layout ?? "force" },
    treeVisible: true,
    setTreeVisible: vi.fn(),
    pushToast: vi.fn(),
  } as unknown as AppContextValue;

  function Harness(): ReactNode {
    return (
      <TestAppearanceProvider>
        <AppCtx.Provider value={value}>
          <GraphView />
        </AppCtx.Provider>
      </TestAppearanceProvider>
    );
  }
  return { ...render(<Harness />), ctx: value };
}

beforeEach(() => {
  localStorage.clear();
  mockInstance.building = false;
  mockInstance.sigmaReady = 1;
  mockInstance.scene = "rings";
  runtimeSigma = null;
  runtimeGraph = null;
  runtimeActiveTween = null;
  runtimeStopDragSim = null;
  runtimeOrbitTargets = new Map();
});

describe("GraphView states", () => {
  it("shows the empty-graph prompt when there are no notes", () => {
    renderGraph([]);
    expect(screen.getByText("Your graph is empty")).toBeInTheDocument();
    expect(screen.queryByText(/notes? ·/)).not.toBeInTheDocument();
  });

  it("shows a loading state instead of the empty prompt during the initial fetch", () => {
    renderGraph([], { notesLoaded: false });
    expect(screen.getByText(/Loading your vault/)).toBeInTheDocument();
    expect(screen.queryByText("Your graph is empty")).not.toBeInTheDocument();
  });

  it("shows an error state instead of the empty prompt after a failed fetch", () => {
    renderGraph([], { notesError: "Network error" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your vault");
    expect(alert).toHaveTextContent(/Network error.*Check the backend/);
    expect(screen.queryByText("Your graph is empty")).not.toBeInTheDocument();
  });

  it("renders the note and link counts", () => {
    renderGraph([mkNote("a", ["b"]), mkNote("b", ["a"]), mkNote("c")]);
    // Reciprocal note links collapse into one undirected visual edge.
    expect(screen.getByText(/3 notes · 1 link$/)).toBeInTheDocument();
  });

  it("reports counts for the visible induced subgraph", () => {
    renderGraph([mkNote("p", ["t"], "projects"), mkNote("t", ["p"])], {
      filter: { folder: "projects" },
    });
    expect(screen.getByText(/1 of 2 notes · 0 links/)).toBeInTheDocument();
  });

  it("offers to clear filters when no notes match", async () => {
    const user = userEvent.setup();
    const { ctx } = renderGraph([mkNote("t")], {
      filter: { folder: "projects" },
    });
    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent("No notes match these filters.");
    await user.click(
      within(empty).getByRole("button", { name: "Clear filters" }),
    );
    expect(ctx.resetGraphFilter).toHaveBeenCalled();
  });

  it("shows the building loader while the layout is arranging", () => {
    mockInstance.building = true;
    renderGraph([mkNote("a"), mkNote("b")]);
    expect(screen.getByRole("status")).toHaveTextContent(/Arranging 2 notes/);
  });

  it("names the scene for a scene layout only", () => {
    mockInstance.scene = "spiral";
    const { unmount } = renderGraph([mkNote("a")], { layout: "spiral" });
    expect(screen.getByText("Spiral")).toBeInTheDocument();
    unmount();
    renderGraph([mkNote("a")]);
    expect(screen.queryByText("Spiral")).not.toBeInTheDocument();
  });

  it("flags paused animations only past the perf budget", () => {
    const { unmount } = renderGraph([mkNote("a"), mkNote("b")]);
    expect(screen.queryByText(/animations paused/)).not.toBeInTheDocument();
    unmount();
    renderGraph(Array.from({ length: 501 }, (_, i) => mkNote(`n${i}`)));
    expect(screen.getByText(/animations paused/)).toBeInTheDocument();
  });
});

describe("GraphView sidebar and toolbar", () => {
  const vault = [
    mkNote("a", ["b"], "projects"),
    mkNote("b", ["a"], "projects"),
    mkNote("c", [], "topics"),
  ];

  it("lists folders with counts and filters by one", async () => {
    const user = userEvent.setup();
    const { ctx } = renderGraph(vault);
    const nav = screen.getByRole("navigation", { name: "Graph filters" });
    expect(
      within(nav).getByRole("button", { name: /All notes 3/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(within(nav).getByRole("button", { name: /projects 2/ }));
    expect(ctx.setGraphFilter).toHaveBeenCalledWith({ folder: "projects" });
  });

  it("names communities after their most-linked note and filters by one", async () => {
    const user = userEvent.setup();
    const { ctx } = renderGraph(vault);
    const nav = screen.getByRole("navigation", { name: "Graph filters" });
    await user.click(within(nav).getByRole("button", { name: /^a 2/ }));
    expect(ctx.setGraphFilter).toHaveBeenCalledWith({ community: 0 });
    await user.click(within(nav).getByRole("button", { name: /Other 1/ }));
    expect(ctx.setGraphFilter).toHaveBeenCalledWith({ community: "other" });
  });

  it("shows superseded notes on request", async () => {
    const user = userEvent.setup();
    const { ctx } = renderGraph(vault);
    const toggle = screen.getByRole("button", { name: "Superseded" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(ctx.setGraphFilter).toHaveBeenCalledWith({ showSuperseded: true });
  });

  it("remembers whether communities are colored", async () => {
    const user = userEvent.setup();
    renderGraph(vault);
    const toggle = screen.getByRole("button", { name: "Communities" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("loom.graph.communities")).toBe("0");
  });

  it("puts the filter and the selected note in the breadcrumb", () => {
    renderGraph(vault, { filter: { folder: "projects" }, selected: "a" });
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(crumbs).toHaveTextContent(/demo.*projects.*a/);
  });

  it("toggles the sidebar", async () => {
    const user = userEvent.setup();
    const { ctx } = renderGraph(vault);
    await user.click(
      screen.getByRole("button", { name: "Toggle graph sidebar" }),
    );
    expect(ctx.setTreeVisible).toHaveBeenCalledWith(false);
  });
});

describe("GraphView selection", () => {
  const chain = [mkNote("a", ["b"]), mkNote("b", ["far"]), mkNote("far")];

  it("opens the selected note beside the graph and closes it", async () => {
    const user = userEvent.setup();
    const { ctx } = renderGraph(chain, { selected: "a" });
    const panel = screen.getByRole("complementary", { name: "Open note" });
    expect(panel).toHaveTextContent("a");
    await user.click(within(panel).getByRole("button", { name: "Close note" }));
    expect(ctx.setGraphSelectedId).toHaveBeenCalledWith(null);
  });

  it("shows no panel without a selection", () => {
    renderGraph(chain);
    expect(
      screen.queryByRole("complementary", { name: "Open note" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Local only" })).toBeDisabled();
  });

  it("narrows the graph to the selection's direct links with Local only", async () => {
    const user = userEvent.setup();
    renderGraph(chain, { selected: "a" });
    await user.click(screen.getByRole("button", { name: "Local only" }));
    expect(
      screen.getByText(/2 of 3 notes · 1 link · local to a/),
    ).toBeInTheDocument();
  });

  it("clears the selection with Escape and opens the full editor with Enter", async () => {
    const user = userEvent.setup();
    const { ctx } = renderGraph(chain, { selected: "a" });
    screen.getByRole("application", { name: "Knowledge graph" }).focus();
    await user.keyboard("{Enter}");
    expect(ctx.openNote).toHaveBeenCalledWith("a");
    await user.keyboard("{Escape}");
    expect(ctx.setGraphSelectedId).toHaveBeenCalledWith(null);
  });

  it("clears a selection the folder filter hides", () => {
    const { ctx } = renderGraph([mkNote("p", [], "projects"), mkNote("t")], {
      filter: { folder: "topics" },
      selected: "p",
    });
    expect(ctx.setGraphSelectedId).toHaveBeenCalledWith(null);
  });

  it("keeps a selection the timeline hides", () => {
    const { ctx } = renderGraph(chain, {
      filter: { createdBefore: Date.parse("2026-04-01T00:00:00Z") },
      selected: "a",
    });
    expect(ctx.setGraphSelectedId).not.toHaveBeenCalled();
  });
});

describe("GraphView canvas controls", () => {
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
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Sigma;
    const cancel = vi.fn();
    runtimeActiveTween = { cancel };
    runtimeStopDragSim = vi.fn();
    runtimeOrbitTargets = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 10, y: 20 }],
    ]);

    renderGraph([mkNote("a"), mkNote("b")], { layout: "rings" });
    await user.click(screen.getByRole("button", { name: "Fit graph (F)" }));

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

  it("zooms the camera in and out", async () => {
    const user = userEvent.setup();
    const animatedZoom = vi.fn();
    const animatedUnzoom = vi.fn();
    runtimeSigma = {
      getCamera: () => ({ animatedZoom, animatedUnzoom }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Sigma;
    renderGraph([mkNote("a")]);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(animatedZoom).toHaveBeenCalledTimes(1);
    expect(animatedUnzoom).toHaveBeenCalledTimes(1);
  });

  it("scrubs the timeline by creation date, back to today at the end", () => {
    const { ctx } = renderGraph([mkNote("a")]);
    const slider = screen.getByRole("slider", {
      name: "Show notes created up to",
    });
    expect(slider).toHaveAttribute("aria-valuetext", "Today");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(ctx.setGraphFilter).toHaveBeenLastCalledWith({
      createdBefore: Date.parse("2026-05-01T00:00:00Z"),
    });
  });
});

/*
Frontend testing conventions:
- Test behavior, not implementation: render, rerender, assert observable output.
- Mock the leak-prone imperative edges (the Sigma renderer, drag, overlay
  animators, debug hook) and keep graphology + the shared frame loop real, so
  graph contents and the requestAnimationFrame lifecycle are exercised for true.

This suite guards the Sigma lifecycle contract of useGraphInstance:
- mount builds ONE Sigma over a graph holding every note node + link edge;
- unmount tears it all down (sigma.kill, camera listener off, overlay animators
  destroyed + unsubscribed, frame loop stopped) — no rAF or listener leaks;
- adding/removing a note or link patches the live graph in place: NO kill, no
  new Sigma, camera untouched, existing nodes (incl. dragged ones) keep their
  positions and new nodes land beside their neighbors;
- a contentKey-only change patches attributes in place (NO kill, NO rebuild);
- only an unpatchable change (no surviving node) falls back to a full rebuild,
  seeded from the positions snapshot at teardown.
*/
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Graph from "graphology";
import { GRAPH_DISPLAY_DEFAULTS } from "../context/app-ctx";
import type { GraphDisplay } from "../context/app-ctx";
import type { Note, NoteId } from "../data/types";
import { useGraphInstance } from "./useGraphInstance";
import { applyConstellationLayout, type XY } from "./layouts";
import { attachDrag } from "./dragHandlers";
import { createTravelers } from "./travelers";
import { createLens } from "./lens";
import { installGraphDebugHook } from "./graphDebug";
import type { GraphTuning } from "./tuning";

type Handler = (...args: unknown[]) => void;

interface CameraStub {
  ratio: number;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  animate: ReturnType<typeof vi.fn>;
  animatedReset: ReturnType<typeof vi.fn>;
  listenerCount: (event: string) => number;
}

/** The observable surface of the mocked Sigma renderer instances. */
interface SigmaStub {
  graph: Graph;
  container: HTMLElement;
  settings: unknown;
  kill: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  setSetting: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  getCamera: () => CameraStub;
  setCustomBBox: ReturnType<typeof vi.fn>;
  graphToViewport: (p: XY) => XY;
  viewportToGraph: (p: XY) => XY;
  listenerCount: (event: string) => number;
}

interface OverlayStub {
  tick: ReturnType<typeof vi.fn>;
  sync?: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface DebugHookStub {
  markReady: ReturnType<typeof vi.fn>;
  uninstall: ReturnType<typeof vi.fn>;
}

// Hoisted registries: the mock factories below push every constructed object
// here so tests can inspect instances without reaching into module internals.
const h = vi.hoisted(() => ({
  sigmaInstances: [] as unknown[],
}));

function sigmaInstances(): SigmaStub[] {
  return h.sigmaInstances as SigmaStub[];
}

// The Sigma renderer: a plain class recording its constructor graph/container
// and tracking event subscriptions so teardown can prove they were removed.
vi.mock("sigma", () => {
  function makeEmitter() {
    const handlers = new Map<string, Set<Handler>>();
    return {
      handlers,
      on: vi.fn((event: string, fn: Handler) => {
        const set = handlers.get(event) ?? new Set<Handler>();
        set.add(fn);
        handlers.set(event, set);
      }),
      off: vi.fn((event: string, fn: Handler) => {
        handlers.get(event)?.delete(fn);
      }),
      listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
    };
  }

  class SigmaStub {
    private emitter = makeEmitter();
    private cameraEmitter = makeEmitter();
    camera: CameraStub = {
      ratio: 1,
      on: this.cameraEmitter.on,
      off: this.cameraEmitter.off,
      animate: vi.fn(),
      animatedReset: vi.fn(),
      listenerCount: this.cameraEmitter.listenerCount,
    };
    kill = vi.fn((): void => {
      // Mirror the real Sigma.kill(): every subscription dies with the instance.
      this.emitter.handlers.clear();
      this.cameraEmitter.handlers.clear();
    });
    refresh = vi.fn();
    resize = vi.fn();
    setSetting = vi.fn();
    on = this.emitter.on;
    off = this.emitter.off;
    listenerCount = this.emitter.listenerCount;
    graphToViewport = (p: XY): XY => p;
    viewportToGraph = (p: XY): XY => p;
    private customBBox: unknown = null;
    getBBox = () => ({ x: [0, 100], y: [-100, 0] });
    getCustomBBox = () => this.customBBox;
    setCustomBBox = vi.fn((bbox: unknown) => {
      this.customBBox = bbox;
    });
    getSetting = vi.fn(() => undefined);
    // In-place syncs park the renderer on an empty copy and re-attach it.
    setGraph = vi.fn((graph: Graph) => {
      this.graph = graph;
    });

    constructor(
      public graph: Graph,
      public container: HTMLElement,
      public settings: unknown,
    ) {
      h.sigmaInstances.push(this);
    }

    getCamera(): CameraStub {
      return this.camera;
    }
  }
  return { default: SigmaStub };
});

// Stub the layout pass: keep the real module's orbit scenes + easing, but make
// applyConstellationLayout a seed-respecting fake so tests can observe exactly
// which cached positions a rebuild was handed (the real one runs ForceAtlas2).
vi.mock("./layouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./layouts")>();
  return {
    ...actual,
    applyConstellationLayout: vi.fn(
      (graph: Graph, seed?: Map<string, XY>): Map<string, XY> => {
        let i = 0;
        const out = new Map<string, XY>();
        graph.forEachNode((id) => {
          const known = seed?.get(id) ?? { x: (i + 1) * 10, y: (i + 1) * -10 };
          graph.setNodeAttribute(id, "x", known.x);
          graph.setNodeAttribute(id, "y", known.y);
          out.set(id, { ...known });
          i++;
        });
        return out;
      },
    ),
  };
});

// Drag, overlay animators, and the dev debug hook are imperative DOM/rAF
// surfaces; stub each with a destroy/uninstall spy so teardown is observable.
vi.mock("./dragHandlers", () => ({
  attachDrag: vi.fn(() => vi.fn()),
}));
vi.mock("./travelers", () => ({
  createTravelers: vi.fn(
    (): OverlayStub => ({
      tick: vi.fn(() => false),
      sync: vi.fn(),
      destroy: vi.fn(),
    }),
  ),
}));
vi.mock("./lens", () => ({
  createLens: vi.fn(
    (): OverlayStub => ({ tick: vi.fn(() => false), destroy: vi.fn() }),
  ),
}));
vi.mock("./graphDebug", () => ({
  installGraphDebugHook: vi.fn(
    (): DebugHookStub => ({ markReady: vi.fn(), uninstall: vi.fn() }),
  ),
}));

const layoutMock = vi.mocked(applyConstellationLayout);
const attachDragMock = vi.mocked(attachDrag);
const travelersMock = vi.mocked(createTravelers);
const lensMock = vi.mocked(createLens);
const debugHookMock = vi.mocked(installGraphDebugHook);

function detachSpies(): Array<ReturnType<typeof vi.fn>> {
  return attachDragMock.mock.results.map((r) => r.value as never);
}
function travelerStubs(): OverlayStub[] {
  return travelersMock.mock.results.map((r) => r.value as OverlayStub);
}
function lensStubs(): OverlayStub[] {
  return lensMock.mock.results.map((r) => r.value as OverlayStub);
}
function debugStubs(): DebugHookStub[] {
  return debugHookMock.mock.results.map((r) => r.value as DebugHookStub);
}

/** A controllable requestAnimationFrame (see frameLoop.test.ts): callbacks
 * queue up and only run when the test flushes. cancelAnimationFrame removes by
 * id so ``queued`` is a true leak signal. */
function installRaf() {
  const queue = new Map<number, FrameRequestCallback>();
  let now = 0;
  let nextId = 1;

  const raf = vi.fn((cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  const caf = vi.fn((id: number) => {
    queue.delete(id);
  });

  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);

  return {
    raf,
    caf,
    /** Run one frame: drain the current queue at the given timestamp. */
    flush(step = 16) {
      now += step;
      const pending = [...queue.values()];
      queue.clear();
      for (const cb of pending) cb(now);
    },
    get queued() {
      return queue.size;
    },
  };
}

/** jsdom has no ResizeObserver; record instances to assert disconnect. */
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }
}

function ref<T>(current: T): { current: T } {
  return { current };
}

function note(
  id: string,
  links: string[] = [],
  overrides: Partial<Note> = {},
): Note {
  return {
    id: id as NoteId,
    title: id,
    type: "topic",
    links: links as NoteId[],
    ...overrides,
  } as unknown as Note;
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
  };
}

function setup(initialNotes: Note[]) {
  const host = document.createElement("div");
  const overlay = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as SVGSVGElement;
  const args = {
    hostRef: ref<HTMLDivElement | null>(host),
    overlayRef: ref<SVGSVGElement | null>(overlay),
    tuningRef: ref<GraphTuning>(makeTuning()),
    graphDisplayRef: ref<GraphDisplay>({ ...GRAPH_DISPLAY_DEFAULTS }),
    openNote: vi.fn(),
    onEdgeClick: vi.fn(),
    setGraphFocusId: vi.fn(),
    setGraphSelectedId: vi.fn(),
  };
  const view = renderHook(
    (props: { notes: Note[] }) =>
      useGraphInstance({ ...args, notes: props.notes }),
    { initialProps: { notes: initialNotes } },
  );
  return { ...view, ...args, host, overlay };
}

describe("useGraphInstance — Sigma lifecycle", () => {
  let clock: ReturnType<typeof installRaf>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.sigmaInstances = [];
    ResizeObserverStub.instances = [];
    clock = installRaf();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Run the deferred build frame (and any follow-up state flush). */
  function build() {
    act(() => {
      clock.flush();
    });
  }

  it("builds one Sigma whose graph holds every note node and link edge", () => {
    const { host, result } = setup([note("a", ["b"]), note("b"), note("c")]);

    // The heavy build is deferred one frame so the shimmer can paint first.
    expect(sigmaInstances()).toHaveLength(0);
    build();

    expect(sigmaInstances()).toHaveLength(1);
    const inst = sigmaInstances()[0]!;
    expect(inst.container).toBe(host);
    expect(inst.graph.order).toBe(3);
    expect(inst.graph.hasNode("a")).toBe(true);
    expect(inst.graph.hasEdge("a", "b")).toBe(true);
    expect(inst.graph.size).toBe(1); // a→b is the only link

    // Below the perf budget the overlay animators register on the frame loop.
    expect(travelersMock).toHaveBeenCalledTimes(1);
    expect(lensMock).toHaveBeenCalledTimes(1);
    expect(result.current.frameLoopRef.current?.size).toBe(2);
    expect(result.current.sigmaReady).toBe(1);
    expect(result.current.building).toBe(false);
  });

  it("reports the selected relationship when an edge is clicked", () => {
    const { onEdgeClick, setGraphSelectedId } = setup([
      note("a", ["b"]),
      note("b"),
    ]);
    build();
    const instance = sigmaInstances()[0]!;
    const edge = instance.graph.edge("a", "b");
    const handler = instance.on.mock.calls.find(
      ([event]) => event === "clickEdge",
    )?.[1] as ((event: { edge: string }) => void) | undefined;

    expect(edge).toBeTruthy();
    expect(handler).toBeDefined();
    act(() => {
      handler?.({ edge: edge! });
    });

    expect(onEdgeClick).toHaveBeenCalledWith("a", "b");
    expect(setGraphSelectedId).toHaveBeenCalledWith("a");
  });

  it("does not construct a Sigma when there are no notes", () => {
    setup([]);
    build();
    expect(sigmaInstances()).toHaveLength(0);
    expect(travelersMock).not.toHaveBeenCalled();
  });

  it("tears the instance down on unmount with no rAF or listener leaks", () => {
    const { unmount, result } = setup([note("a", ["b"]), note("b")]);
    build();
    const inst = sigmaInstances()[0]!;
    const detach = detachSpies()[0]!;
    const travelers = travelerStubs()[0]!;
    const lens = lensStubs()[0]!;
    const debug = debugStubs()[0]!;

    // Sanity: live subscriptions the teardown must unwind.
    expect(inst.listenerCount("clickNode")).toBe(1);
    expect(inst.listenerCount("clickEdge")).toBe(1);
    expect(inst.camera.listenerCount("updated")).toBe(1);
    expect(clock.queued).toBe(1); // the shared frame loop holds one pending frame

    unmount();

    // Renderer killed exactly once; camera + node listeners are gone.
    expect(inst.kill).toHaveBeenCalledTimes(1);
    expect(inst.camera.off).toHaveBeenCalledWith(
      "updated",
      expect.any(Function),
    );
    expect(inst.camera.listenerCount("updated")).toBe(0);
    expect(inst.listenerCount("clickNode")).toBe(0);
    expect(inst.listenerCount("clickEdge")).toBe(0);

    // Drag detached, overlay animators destroyed, debug hook uninstalled,
    // ResizeObserver disconnected, refs cleared.
    expect(detach).toHaveBeenCalledTimes(1);
    expect(travelers.destroy).toHaveBeenCalledTimes(1);
    expect(lens.destroy).toHaveBeenCalledTimes(1);
    expect(debug.uninstall).toHaveBeenCalledTimes(1);
    expect(ResizeObserverStub.instances[0]!.disconnect).toHaveBeenCalledTimes(
      1,
    );
    expect(result.current.sigmaRef.current).toBeNull();
    expect(result.current.graphRef.current).toBeNull();
    expect(result.current.frameLoopRef.current).toBeNull();

    // No animation frame survives the teardown; a late flush cannot tick the
    // dead instance (the frame loop's onRefresh would call sigma.refresh).
    expect(clock.queued).toBe(0);
    const refreshes = inst.refresh.mock.calls.length;
    act(() => {
      clock.flush();
    });
    expect(inst.refresh.mock.calls.length).toBe(refreshes);
  });

  it("adds a note in place: no kill, same Sigma, camera untouched", () => {
    const { rerender, result } = setup([note("a", ["b"]), note("b")]);
    build();
    expect(sigmaInstances()).toHaveLength(1);
    const inst = sigmaInstances()[0]!;
    const frameLoop = result.current.frameLoopRef.current;

    rerender({ notes: [note("a", ["b"]), note("b"), note("c", ["a"])] });

    // Same renderer, graph, frame loop and camera — nothing was rebuilt.
    expect(inst.kill).not.toHaveBeenCalled();
    expect(sigmaInstances()).toHaveLength(1);
    expect(result.current.graphRef.current).toBe(inst.graph);
    expect(result.current.frameLoopRef.current).toBe(frameLoop);
    expect(inst.camera.animate).not.toHaveBeenCalled();
    expect(inst.camera.animatedReset).not.toHaveBeenCalled();
    expect(layoutMock).toHaveBeenCalledTimes(1);
    // The structure changed in place; no deferred build frame is pending.
    expect(inst.graph.hasNode("c")).toBe(true);
    expect(inst.graph.hasEdge("c", "a")).toBe(true);
    expect(result.current.structureVersion).toBe(1);
    expect(result.current.sigmaReady).toBe(1);
    expect(result.current.building).toBe(false);
    // Overlays were patched, not recreated.
    expect(travelersMock).toHaveBeenCalledTimes(1);
    expect(travelerStubs()[0]!.sync).toHaveBeenCalledTimes(1);
  });

  it("places a new note beside its neighbor", () => {
    const { rerender, result } = setup([note("a", ["b"]), note("b")]);
    build();
    const graph = result.current.graphRef.current!;
    // The layout fake seeded a at (10,-10) and b at (20,-20).

    rerender({ notes: [note("a", ["b"]), note("b"), note("c", ["b"])] });

    const c = {
      x: graph.getNodeAttribute("c", "x") as number,
      y: graph.getNodeAttribute("c", "y") as number,
    };
    expect(Math.hypot(c.x - 20, c.y + 20)).toBeLessThan(100);
    expect(result.current.basePositionsRef.current.get("c")).toEqual(c);
  });

  it("removes a note and its links in place", () => {
    const { rerender, result } = setup([
      note("a", ["b"]),
      note("b", ["c"]),
      note("c"),
    ]);
    build();
    const inst = sigmaInstances()[0]!;

    rerender({ notes: [note("a"), note("c")] });

    expect(inst.kill).not.toHaveBeenCalled();
    expect(inst.graph.hasNode("b")).toBe(false);
    expect(inst.graph.size).toBe(0);
    expect(result.current.basePositionsRef.current.has("b")).toBe(false);
    expect(result.current.structureVersion).toBe(1);
  });

  it("patches title/type in place when only contentKey changes (no rebuild)", () => {
    const { rerender } = setup([note("a", ["b"]), note("b")]);
    build();
    expect(sigmaInstances()).toHaveLength(1);
    const inst = sigmaInstances()[0]!;
    const layoutCalls = layoutMock.mock.calls.length;
    const refreshCalls = inst.refresh.mock.calls.length;

    rerender({
      notes: [
        note("a", ["b"], { title: "Renamed", type: "project" }),
        note("b"),
      ],
    });

    // Same structure → same instance: no kill, no new Sigma, no relayout.
    expect(sigmaInstances()).toHaveLength(1);
    expect(inst.kill).not.toHaveBeenCalled();
    expect(layoutMock.mock.calls.length).toBe(layoutCalls);

    // Attributes patched on the live graph + a refresh to repaint them.
    expect(inst.graph.getNodeAttribute("a", "label")).toBe("Renamed");
    expect(inst.graph.getNodeAttribute("a", "noteType")).toBe("project");
    expect(inst.refresh.mock.calls.length).toBeGreaterThan(refreshCalls);
  });

  it("keeps a dragged node's placement across a structural change", () => {
    const { rerender, result } = setup([note("a", ["b"]), note("b")]);
    build();
    // First build has an empty position cache — every node got a fresh slot.
    expect(layoutMock.mock.calls[0]?.[1]?.size).toBe(0);

    // Simulate a drag: attachDrag mutates the live graph's x/y mid-drag.
    const graph = result.current.graphRef.current!;
    act(() => {
      graph.setNodeAttribute("a", "x", 111);
      graph.setNodeAttribute("a", "y", 222);
    });

    rerender({ notes: [note("a", ["b"]), note("b"), note("c")] });

    // No relayout ran, so the dragged node is exactly where it was.
    expect(layoutMock).toHaveBeenCalledTimes(1);
    expect(graph.getNodeAttribute("a", "x")).toBe(111);
    expect(graph.getNodeAttribute("a", "y")).toBe(222);
  });

  it("rebuilds from the teardown snapshot when no node survives", () => {
    const { rerender, result } = setup([note("a", ["b"]), note("b")]);
    build();
    const first = sigmaInstances()[0]!;
    const graph = result.current.graphRef.current!;
    act(() => {
      graph.setNodeAttribute("a", "x", 111);
      graph.setNodeAttribute("a", "y", 222);
    });

    rerender({ notes: [note("x", ["y"]), note("y")] });
    // The sync could not patch it, so the old instance is torn down…
    expect(first.kill).toHaveBeenCalledTimes(1);
    build();

    // …and a fresh Sigma is built, handed the old positions as its seed.
    expect(sigmaInstances()).toHaveLength(2);
    const rebuilt = sigmaInstances()[1]!.graph;
    expect(rebuilt.hasNode("x")).toBe(true);
    expect(rebuilt.hasEdge("x", "y")).toBe(true);
    expect(layoutMock.mock.calls[1]?.[1]?.get("a")).toEqual({ x: 111, y: 222 });
    expect(result.current.sigmaReady).toBe(2);
  });
});

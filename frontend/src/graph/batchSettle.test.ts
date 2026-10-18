import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import {
  BATCH_SETTLE_LARGE_NODES,
  BATCH_SETTLE_MIN_NODES,
  BATCH_SETTLE_MS,
  isLargeBatch,
  startBatchSettle,
} from "./batchSettle";
import type { FrameLoop, FrameTick } from "./frameLoop";
import type { XY } from "./orbitScenes";

/** The FA2 worker supervisor, minus the worker: it records the graph it was
 * handed so a test can play the worker's part by writing positions into it. */
interface FakeLayout {
  graph: Graph;
  params: { settings?: Record<string, unknown> };
  start: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

const fa2 = vi.hoisted(() => ({
  instances: [] as unknown[],
  failToSpawn: false,
}));

vi.mock("graphology-layout-forceatlas2/worker", () => ({
  default: class {
    graph: Graph;
    params: unknown;
    start = vi.fn();
    stop = vi.fn();
    kill = vi.fn();
    isRunning = vi.fn(() => true);
    constructor(graph: Graph, params: unknown) {
      if (fa2.failToSpawn) throw new Error("worker blocked");
      this.graph = graph;
      this.params = params;
      fa2.instances.push(this);
    }
  },
}));

function layouts(): FakeLayout[] {
  return fa2.instances as FakeLayout[];
}

/** Ticks register here and run only when the test calls ``frame``. */
function fakeFrameLoop() {
  const ticks = new Set<FrameTick>();
  const loop = {
    add: (tick: FrameTick) => {
      ticks.add(tick);
      return () => ticks.delete(tick);
    },
    stop: vi.fn(),
    get size() {
      return ticks.size;
    },
  };
  const frame = (): boolean => [...ticks].map((tick) => tick(0)).some(Boolean);
  return { loop: loop as FrameLoop, frame };
}

/** Survivors s0—s1—s2 on the x axis, then four new nodes stacked beside s0. */
function setup(durationMs?: number) {
  const graph = new Graph({ multi: false, type: "directed" });
  const homes = new Map<string, XY>();
  for (let i = 0; i < 3; i++) {
    graph.addNode(`s${i}`, { x: i * 100, y: 0, size: 4 });
    homes.set(`s${i}`, { x: i * 100, y: 0 });
  }
  graph.addEdge("s0", "s1");
  graph.addEdge("s1", "s2");
  const ids = ["n0", "n1", "n2", "n3"];
  for (const id of ids) {
    graph.addNode(id, { x: -10, y: 5, size: 4 });
    graph.addEdge(id, "s0");
    homes.set(id, { x: -10, y: 5 });
  }
  const sigma = { refresh: vi.fn() };
  const { loop, frame } = fakeFrameLoop();
  const homesRef = { current: homes };
  const handle = startBatchSettle({
    graph,
    sigma: sigma as unknown as Sigma,
    frameLoop: loop,
    ids,
    homesRef,
    durationMs,
  });
  return { graph, sigma, loop, frame, homesRef, handle, ids };
}

/** Play one worker message: spread the new nodes along a column at x. */
function workerSpreads(layout: FakeLayout, x: number): void {
  ["n0", "n1", "n2", "n3"].forEach((id, i) => {
    layout.graph.mergeNodeAttributes(id, { x, y: i * 40 });
  });
}

function pos(graph: Graph, id: string): XY {
  return {
    x: graph.getNodeAttribute(id, "x") as number,
    y: graph.getNodeAttribute(id, "y") as number,
  };
}

describe("isLargeBatch", () => {
  it("keeps a handful of new notes on the synchronous path", () => {
    expect(isLargeBatch(BATCH_SETTLE_MIN_NODES - 1, 1)).toBe(false);
    expect(isLargeBatch(3, 0)).toBe(false);
  });

  it("settles a batch that outnumbers the survivors", () => {
    expect(isLargeBatch(BATCH_SETTLE_MIN_NODES, 4)).toBe(true);
    expect(isLargeBatch(20, 19)).toBe(true);
    expect(isLargeBatch(20, 20)).toBe(false);
  });

  it("settles any batch past the large-batch size", () => {
    expect(isLargeBatch(BATCH_SETTLE_LARGE_NODES + 1, 5000)).toBe(true);
    expect(isLargeBatch(BATCH_SETTLE_LARGE_NODES, 5000)).toBe(false);
  });
});

describe("startBatchSettle", () => {
  beforeEach(() => {
    fa2.instances = [];
    fa2.failToSpawn = false;
    vi.useFakeTimers();
    vi.stubGlobal("Worker", class {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs FA2 on a copy with every survivor pinned", () => {
    const { graph } = setup();
    expect(layouts()).toHaveLength(1);
    const layout = layouts()[0]!;
    expect(layout.start).toHaveBeenCalledTimes(1);
    // The worker never writes the graph Sigma renders.
    expect(layout.graph).not.toBe(graph);
    expect(layout.graph.order).toBe(graph.order);
    expect(layout.graph.size).toBe(graph.size);
    expect(layout.graph.getNodeAttribute("s1", "fixed")).toBe(true);
    expect(layout.graph.getNodeAttribute("n0", "fixed")).toBe(false);
    expect(layout.graph.getNodeAttributes("n2")).toMatchObject({
      x: -10,
      y: 5,
    });
    expect(layout.params.settings).toMatchObject({
      outboundAttractionDistribution: true,
    });
  });

  it("streams the worker's positions into the live graph per frame", () => {
    const { graph, frame } = setup();
    // No worker output yet: nothing to repaint.
    expect(frame()).toBe(false);

    workerSpreads(layouts()[0]!, -80);
    expect(pos(graph, "n0")).toEqual({ x: -10, y: 5 });
    expect(frame()).toBe(true);
    expect(pos(graph, "n3")).toEqual({ x: -80, y: 120 });
    // Survivors stay where they were.
    expect(pos(graph, "s0")).toEqual({ x: 0, y: 0 });
    expect(frame()).toBe(false);
  });

  it("stops after its budget and records the settled homes", () => {
    const { graph, sigma, loop, homesRef } = setup();
    const layout = layouts()[0]!;
    workerSpreads(layout, -300);

    vi.advanceTimersByTime(BATCH_SETTLE_MS - 1);
    expect(layout.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(layout.kill).toHaveBeenCalledTimes(1);
    expect(loop.size).toBe(0);
    // The last worker message lands even without another frame.
    expect(pos(graph, "n2").x).toBeCloseTo(-300, 0);
    expect(homesRef.current.get("n2")).toEqual(pos(graph, "n2"));
    expect(homesRef.current.get("s1")).toEqual({ x: 100, y: 0 });
    // One full refresh re-indexes the settled nodes.
    expect(sigma.refresh).toHaveBeenCalledTimes(1);
  });

  it("stops the worker on cancel and keeps the batch where it is", () => {
    const { graph, sigma, loop, frame, homesRef, handle } = setup();
    const layout = layouts()[0]!;
    workerSpreads(layout, -80);
    frame();
    workerSpreads(layout, -200);

    handle!.cancel();

    expect(layout.kill).toHaveBeenCalledTimes(1);
    expect(loop.size).toBe(0);
    // The home is what was on screen, not the unseen later message.
    expect(pos(graph, "n1")).toEqual({ x: -80, y: 40 });
    expect(homesRef.current.get("n1")).toEqual({ x: -80, y: 40 });

    // The budget timer died with it, and a second cancel is a no-op.
    vi.advanceTimersByTime(BATCH_SETTLE_MS);
    handle!.cancel();
    expect(layout.kill).toHaveBeenCalledTimes(1);
    expect(sigma.refresh).not.toHaveBeenCalled();
    expect(pos(graph, "n1")).toEqual({ x: -80, y: 40 });
  });

  it("honors a custom budget", () => {
    setup(500);
    vi.advanceTimersByTime(500);
    expect(layouts()[0]!.kill).toHaveBeenCalledTimes(1);
  });

  it("leaves the placement alone where no worker can run", () => {
    vi.stubGlobal("Worker", undefined);
    const { handle, loop } = setup();
    expect(handle).toBeNull();
    expect(layouts()).toHaveLength(0);
    expect(loop.size).toBe(0);
  });

  it("leaves the placement alone when the worker cannot spawn", () => {
    fa2.failToSpawn = true;
    const { handle, loop, homesRef } = setup();
    expect(handle).toBeNull();
    expect(loop.size).toBe(0);
    expect(homesRef.current.get("n0")).toEqual({ x: -10, y: 5 });
  });
});

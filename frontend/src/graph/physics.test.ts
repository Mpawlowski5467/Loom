import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import { startDragSim } from "./physics";
import type { XY } from "./layouts";

/**
 * Controllable rAF + clock. ``startDragSim`` throttles on performance.now(), so
 * each flush bumps the clock past the 33ms frame interval before draining.
 */
function installRaf() {
  let queue: FrameRequestCallback[] = [];
  let now = 0;
  let nextId = 1;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      queue.push(cb);
      return nextId++;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("performance", { now: () => now });
  return {
    /** Advance the clock and run one frame. */
    step(ms = 40) {
      now += ms;
      const pending = queue;
      queue = [];
      for (const cb of pending) cb(now);
    },
    /** Run many frames so a settling sim converges. */
    run(frames: number, ms = 40) {
      for (let i = 0; i < frames; i++) this.step(ms);
    },
    get queued() {
      return queue.length;
    },
  };
}

function fakeSigma() {
  return { refresh: vi.fn() } as unknown as Sigma & {
    refresh: ReturnType<typeof vi.fn>;
  };
}

function mkGraph(positions: Record<string, XY>, edges: [string, string][]): Graph {
  const g = new Graph();
  for (const [id, { x, y }] of Object.entries(positions)) {
    g.addNode(id, { x, y });
  }
  for (const [s, t] of edges) g.addEdge(s, t);
  return g;
}

function pos(g: Graph, id: string): XY {
  return {
    x: g.getNodeAttribute(id, "x") as number,
    y: g.getNodeAttribute(id, "y") as number,
  };
}

describe("startDragSim", () => {
  let clock: ReturnType<typeof installRaf>;

  beforeEach(() => {
    clock = installRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves the dragged node to the cursor position", () => {
    const g = mkGraph({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, [["a", "b"]]);
    const sim = startDragSim({
      sigma: fakeSigma(),
      graph: g,
      draggedId: "a",
      neighborIds: ["b"],
      getHome: (id) => pos(g, id),
    });
    sim.setDraggedPos(30, 40);
    expect(pos(g, "a")).toEqual({ x: 30, y: 40 });
    sim.stop();
  });

  it("pulls neighbors toward the dragged node's displacement", () => {
    const g = mkGraph({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, [["a", "b"]]);
    const sim = startDragSim({
      sigma: fakeSigma(),
      graph: g,
      draggedId: "a",
      neighborIds: ["b"],
      getHome: (id) => pos(g, id),
    });
    sim.setDraggedPos(200, 0); // drag "a" far to the right
    clock.run(5); // let the spring pull "b"
    // "b" should have moved right of its home (50) toward the pulled target.
    expect(pos(g, "b").x).toBeGreaterThan(50);
    sim.stop();
  });

  it("settles the dragged node back to its home after release", () => {
    const home = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } };
    const g = mkGraph(home, [["a", "b"]]);
    const sim = startDragSim({
      sigma: fakeSigma(),
      graph: g,
      draggedId: "a",
      neighborIds: ["b"],
      getHome: (id) => home[id as "a" | "b"],
    });
    sim.setDraggedPos(150, 120);
    sim.release(0, 0);
    clock.run(120); // run well past convergence

    // The settle path snaps both nodes exactly back to home when kinetic
    // energy drops below the stop threshold.
    expect(pos(g, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(g, "b")).toEqual({ x: 50, y: 0 });
  });

  it("stops requesting frames once a released sim has settled", () => {
    const home = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } };
    const g = mkGraph(home, [["a", "b"]]);
    const sim = startDragSim({
      sigma: fakeSigma(),
      graph: g,
      draggedId: "a",
      neighborIds: ["b"],
      getHome: (id) => home[id as "a" | "b"],
    });
    sim.setDraggedPos(80, 0);
    sim.release(0, 0);
    clock.run(200);
    // After convergence the loop returns without re-queuing a frame.
    expect(clock.queued).toBe(0);
  });

  it("ignores setDraggedPos after release (settle mode owns the position)", () => {
    const home = { a: { x: 0, y: 0 } };
    const g = mkGraph(home, []);
    const sim = startDragSim({
      sigma: fakeSigma(),
      graph: g,
      draggedId: "a",
      neighborIds: [],
      getHome: (id) => home[id as "a"],
    });
    sim.release(0, 0);
    sim.setDraggedPos(999, 999); // should be a no-op now
    expect(pos(g, "a")).not.toEqual({ x: 999, y: 999 });
    sim.stop();
  });

  it("stop cancels the animation frame", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } }, []);
    const sim = startDragSim({
      sigma: fakeSigma(),
      graph: g,
      draggedId: "a",
      neighborIds: [],
      getHome: (id) => pos(g, id),
    });
    sim.stop();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("refreshes Sigma on each simulated frame", () => {
    const g = mkGraph({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, [["a", "b"]]);
    const sigma = fakeSigma();
    const sim = startDragSim({
      sigma,
      graph: g,
      draggedId: "a",
      neighborIds: ["b"],
      getHome: (id) => pos(g, id),
    });
    sim.setDraggedPos(20, 0);
    clock.step();
    expect(sigma.refresh).toHaveBeenCalledWith({ skipIndexation: true });
    sim.stop();
  });

  it("falls back to the node's current attrs when no home is provided", () => {
    const g = mkGraph({ a: { x: 5, y: 7 } }, []);
    // getHome returns undefined → the sim reads x/y straight off the node.
    const sim = startDragSim({
      sigma: fakeSigma(),
      graph: g,
      draggedId: "a",
      neighborIds: [],
      getHome: () => undefined,
    });
    sim.setDraggedPos(40, 40);
    sim.release(0, 0);
    clock.run(150);
    // Settles back to the fallback home (its original 5,7).
    expect(pos(g, "a")).toEqual({ x: 5, y: 7 });
  });
});

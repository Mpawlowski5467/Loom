import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import { startLayoutTween } from "./layoutTransition";
import { createFrameLoop, type FrameLoop } from "./frameLoop";
import type { XY } from "./layouts";

/** Controllable rAF — same pattern as frameLoop.test, drives the frame loop. */
function installRaf() {
  let queue: FrameRequestCallback[] = [];
  let nextId = 1;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      queue.push(cb);
      return nextId++;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    flush(now: number) {
      const pending = queue;
      queue = [];
      for (const cb of pending) cb(now);
    },
  };
}

/** A Sigma stand-in exposing only what the tween touches. */
function fakeSigma() {
  return { refresh: vi.fn() } as unknown as Sigma & { refresh: ReturnType<typeof vi.fn> };
}

function mkGraph(positions: Record<string, XY>): Graph {
  const g = new Graph();
  for (const [id, { x, y }] of Object.entries(positions)) {
    g.addNode(id, { x, y });
  }
  return g;
}

function pos(g: Graph, id: string): XY {
  return {
    x: g.getNodeAttribute(id, "x") as number,
    y: g.getNodeAttribute(id, "y") as number,
  };
}

describe("startLayoutTween", () => {
  let clock: ReturnType<typeof installRaf>;
  let now: number;
  let loop: FrameLoop;
  let onRefresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    now = 1000;
    // performance.now() is read at construction (t0) and inside each tick.
    vi.stubGlobal("performance", { now: () => now });
    clock = installRaf();
    onRefresh = vi.fn();
    loop = createFrameLoop(onRefresh);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("interpolates positions and lands exactly on the targets", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } });
    const sigma = fakeSigma();
    startLayoutTween({
      sigma,
      graph: g,
      targets: new Map([["a", { x: 100, y: 200 }]]),
      frameLoop: loop,
      duration: 100,
    });

    // Halfway through (50/100ms): eased(0.5) === 0.5, so exactly the midpoint.
    now = 1050;
    clock.flush(now);
    expect(pos(g, "a")).toEqual({ x: 50, y: 100 });

    // Past the end: snapped to the target.
    now = 1100;
    clock.flush(now);
    expect(pos(g, "a")).toEqual({ x: 100, y: 200 });
  });

  it("refreshes Sigma and calls onComplete exactly once when finished", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } });
    const sigma = fakeSigma();
    const onComplete = vi.fn();
    startLayoutTween({
      sigma,
      graph: g,
      targets: new Map([["a", { x: 10, y: 10 }]]),
      frameLoop: loop,
      duration: 100,
      onComplete,
    });

    now = 1100;
    clock.flush(now);
    expect(sigma.refresh).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("leaves nodes absent from the targets map untouched", () => {
    const g = mkGraph({ a: { x: 0, y: 0 }, fixed: { x: 7, y: 9 } });
    const sigma = fakeSigma();
    startLayoutTween({
      sigma,
      graph: g,
      targets: new Map([["a", { x: 100, y: 0 }]]), // no entry for "fixed"
      frameLoop: loop,
      duration: 100,
    });

    now = 1050;
    clock.flush(now);
    expect(pos(g, "fixed")).toEqual({ x: 7, y: 9 });
  });

  it("cancel stops further interpolation", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } });
    const sigma = fakeSigma();
    const handle = startLayoutTween({
      sigma,
      graph: g,
      targets: new Map([["a", { x: 100, y: 0 }]]),
      frameLoop: loop,
      duration: 100,
    });

    now = 1050;
    clock.flush(now); // advance to the midpoint
    const mid = pos(g, "a");
    handle.cancel();

    now = 1100;
    clock.flush(now); // would have completed — but the tick is unregistered
    expect(pos(g, "a")).toEqual(mid);
    expect(sigma.refresh).not.toHaveBeenCalled();
  });

  it("unregisters its tick from the frame loop on completion", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } });
    const sigma = fakeSigma();
    startLayoutTween({
      sigma,
      graph: g,
      targets: new Map([["a", { x: 10, y: 0 }]]),
      frameLoop: loop,
      duration: 100,
    });
    expect(loop.size).toBe(1);

    now = 1100;
    clock.flush(now);
    expect(loop.size).toBe(0);
  });
});

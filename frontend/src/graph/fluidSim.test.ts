import { describe, it, expect, vi, beforeEach } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import { startFluidSim, type ReleaseMode } from "./fluidSim";
import {
  collectParticipants,
  makeBodies,
  makeSpringNetwork,
  MAX_PARTICIPANTS,
} from "./fluidForces";
import type { FrameLoop, FrameTick } from "./frameLoop";
import type { XY } from "./layouts";

/**
 * Manually driven FrameLoop stand-in: the sim registers its tick here and the
 * test advances frames explicitly (each default step clears the frame throttle).
 */
function stubFrameLoop() {
  const ticks = new Set<FrameTick>();
  let now = 0;
  const loop = {
    add: (tick: FrameTick) => {
      ticks.add(tick);
      return () => ticks.delete(tick);
    },
    stop: () => ticks.clear(),
    get size() {
      return ticks.size;
    },
  } as FrameLoop;
  return {
    loop,
    step(ms = 40) {
      now += ms;
      for (const t of [...ticks]) t(now);
    },
    run(frames: number) {
      for (let i = 0; i < frames; i++) this.step();
    },
    get size() {
      return ticks.size;
    },
  };
}

function fakeSigma() {
  return {
    refresh: vi.fn(),
  } as unknown as Sigma & {
    refresh: ReturnType<typeof vi.fn>;
  };
}

function mkGraph(
  positions: Record<string, XY & { hidden?: boolean }>,
  edges: [string, string][],
): Graph {
  const g = new Graph();
  for (const [id, attrs] of Object.entries(positions)) {
    g.addNode(id, { size: 4, ...attrs });
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

function startSim(opts: {
  graph: Graph;
  draggedId: string;
  homes?: Record<string, XY>;
  releaseMode?: ReleaseMode;
  sigma?: ReturnType<typeof fakeSigma>;
  onSettled?: (positions: Map<string, XY>) => void;
  onFinished?: () => void;
}) {
  const loop = stubFrameLoop();
  const sigma = opts.sigma ?? fakeSigma();
  const sim = startFluidSim({
    sigma,
    graph: opts.graph,
    frameLoop: loop.loop,
    draggedId: opts.draggedId,
    getHome: (id) => opts.homes?.[id] ?? pos(opts.graph, id),
    getReleaseMode: () => opts.releaseMode ?? "sticky",
    onSettled: opts.onSettled,
    onFinished: opts.onFinished,
  });
  return { sim, loop, sigma };
}

describe("startFluidSim — drag phase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pins the dragged node exactly to the cursor", () => {
    const g = mkGraph({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, [["a", "b"]]);
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(30, 40);
    expect(pos(g, "a")).toEqual({ x: 30, y: 40 });
    loop.run(5);
    expect(pos(g, "a")).toEqual({ x: 30, y: 40 });
    sim.stop();
  });

  it("propagates the drag beyond direct neighbors (2 hops move)", () => {
    const g = mkGraph(
      { a: { x: 0, y: 0 }, b: { x: 60, y: 0 }, c: { x: 120, y: 0 } },
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(-300, 0);
    loop.run(30);
    // b (1 hop) follows the drag left; c (2 hops) is pulled along by the
    // b→c spring — the old sim only ever moved direct neighbors.
    expect(pos(g, "b").x).toBeLessThan(50);
    expect(pos(g, "c").x).toBeLessThan(115);
    sim.stop();
  });

  it("attenuates the reaction across successive graph hops", () => {
    const g = mkGraph(
      {
        a: { x: 0, y: 0 },
        b: { x: 60, y: 0 },
        c: { x: 120, y: 0 },
        d: { x: 180, y: 0 },
      },
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
      ],
    );
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(-300, 0);
    loop.run(30);

    const firstHop = 60 - pos(g, "b").x;
    const secondHop = 120 - pos(g, "c").x;
    const thirdHop = 180 - pos(g, "d").x;
    expect(firstHop).toBeGreaterThan(secondHop);
    expect(secondHop).toBeGreaterThan(thirdHop);
    expect(thirdHop).toBeGreaterThan(0);
    sim.stop();
  });

  it("registers exactly one tick on the shared frame loop and stop() removes it", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } }, []);
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    expect(loop.size).toBe(1);
    sim.stop();
    expect(loop.size).toBe(0);
    sim.stop(); // idempotent
    expect(loop.size).toBe(0);
  });

  it("restores the saved geometry when an active drag is cancelled", () => {
    const homes = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } };
    const g = mkGraph({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, [["a", "b"]]);
    const { sim, loop, sigma } = startSim({
      graph: g,
      draggedId: "a",
      homes,
    });
    sim.setDraggedPos(180, 90);
    loop.run(8);

    sim.stop();

    expect(pos(g, "a")).toEqual(homes.a);
    expect(pos(g, "b")).toEqual(homes.b);
    expect(loop.size).toBe(0);
    expect(sigma.refresh).toHaveBeenCalledWith();
  });

  it("excludes hidden nodes from the simulation", () => {
    const g = mkGraph({ a: { x: 0, y: 0 }, h: { x: 40, y: 0, hidden: true } }, [
      ["a", "h"],
    ]);
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(-400, 0);
    loop.run(30);
    expect(pos(g, "h")).toEqual({ x: 40, y: 0 });
    sim.stop();
  });

  it("batches silent position writes into one scheduled partial refresh per frame", () => {
    const g = mkGraph(
      { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, c: { x: 100, y: 0 } },
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const graphEvents = vi.fn();
    g.on("nodeAttributesUpdated", graphEvents);
    const sigma = fakeSigma();
    const { sim, loop } = startSim({ graph: g, draggedId: "a", sigma });

    sim.setDraggedPos(25, 10);
    sigma.refresh.mockClear();
    loop.step(17);

    expect(graphEvents).not.toHaveBeenCalled();
    expect(sigma.refresh).toHaveBeenCalledTimes(1);
    expect(sigma.refresh).toHaveBeenCalledWith({
      partialGraph: {
        nodes: expect.arrayContaining(["a", "b", "c"]),
        edges: expect.arrayContaining(g.edges()),
      },
      schedule: true,
    });
    sim.stop();
  });
});

describe("startFluidSim — sticky release (force layout)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the dragged position, settles, and reports final positions", () => {
    const g = mkGraph({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, [["a", "b"]]);
    const onSettled = vi.fn();
    const { sim, loop, sigma } = startSim({
      graph: g,
      draggedId: "a",
      releaseMode: "sticky",
      onSettled,
    });
    sim.setDraggedPos(300, 0);
    sim.release(0, 0);
    loop.run(200);

    // Settled: tick unregistered, node stayed where it was dropped.
    expect(loop.size).toBe(0);
    expect(pos(g, "a").x).toBeGreaterThan(150);
    expect(onSettled).toHaveBeenCalledTimes(1);
    const positions = onSettled.mock.calls[0]![0] as Map<string, XY>;
    expect(positions.has("a")).toBe(true);
    expect(positions.has("b")).toBe(true);
    expect(positions.get("a")).toEqual(pos(g, "a"));
    // One full (re-indexing) refresh at the end of the settle.
    expect(sigma.refresh).toHaveBeenCalledWith();
  });

  it("launches the dragged node with the release velocity", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } }, []);
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(100, 0);
    sim.release(30, 0);
    loop.run(3);
    expect(pos(g, "a").x).toBeGreaterThan(100);
    loop.run(200);
    expect(loop.size).toBe(0);
  });

  it("caps an extreme flick so sticky placement stays near the drop point", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } }, []);
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(100, 0);
    sim.release(10_000, 0);
    loop.run(200);

    expect(pos(g, "a").x).toBeGreaterThan(100);
    expect(pos(g, "a").x).toBeLessThan(105);
    expect(loop.size).toBe(0);
  });

  it("ignores setDraggedPos after release", () => {
    const g = mkGraph({ a: { x: 0, y: 0 } }, []);
    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(80, 0);
    sim.release(0, 0);
    sim.setDraggedPos(999, 999);
    expect(pos(g, "a")).not.toEqual({ x: 999, y: 999 });
    loop.run(200);
    expect(pos(g, "a")).not.toEqual({ x: 999, y: 999 });
  });
});

describe("startFluidSim — elastic release (orbit scenes)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("snaps every participant exactly back to its home", () => {
    const homes = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } };
    const g = mkGraph({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, [["a", "b"]]);
    const onSettled = vi.fn();
    const onFinished = vi.fn();
    const { sim, loop, sigma } = startSim({
      graph: g,
      draggedId: "a",
      homes,
      releaseMode: "elastic",
      onSettled,
      onFinished,
    });
    sim.setDraggedPos(200, 120);
    loop.run(10);
    sim.release(0, 0);
    loop.run(300);

    expect(loop.size).toBe(0);
    expect(pos(g, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(g, "b")).toEqual({ x: 50, y: 0 });
    // Elastic settles never rewrite homes.
    expect(onSettled).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
    sim.stop();
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(sigma.refresh).toHaveBeenCalledWith();
  });
});

describe("startFluidSim — participation budget", () => {
  it("uses the same bounded local path at the 500-node UI boundary", () => {
    const g = new Graph();
    g.addNode("hub", { x: 0, y: 0, size: 4 });
    for (let i = 1; i < 500; i++) {
      const id = `n${i}`;
      g.addNode(id, { x: i, y: 0, size: 4 });
      g.addEdge("hub", id);
    }

    expect(collectParticipants(g, "hub").size).toBe(MAX_PARTICIPANTS);
  });

  it("caps participants to a BFS neighborhood on large graphs", () => {
    const g = new Graph();
    // A chain a-b-c-d-e (e is 4 hops out) plus filler to exceed the budget.
    const chain = ["a", "b", "c", "d", "e"];
    chain.forEach((id, i) => g.addNode(id, { x: i * 50, y: 0, size: 4 }));
    for (let i = 0; i < chain.length - 1; i++)
      g.addEdge(chain[i]!, chain[i + 1]!);
    for (let i = 0; i < 600; i++)
      g.addNode(`f${i}`, { x: 2000 + i, y: 500, size: 4 });

    const { sim, loop } = startSim({ graph: g, draggedId: "a" });
    sim.setDraggedPos(-500, 0);
    loop.run(40);

    // Within 3 hops: moves. Beyond 3 hops / disconnected: untouched.
    expect(pos(g, "b").x).toBeLessThan(50);
    expect(pos(g, "e")).toEqual({ x: 200, y: 0 });
    expect(pos(g, "f0")).toEqual({ x: 2000, y: 500 });
    sim.stop();
  });

  it("stops a high-degree BFS as soon as the participant budget is full", () => {
    const g = new Graph();
    g.addNode("hub", { x: 0, y: 0, size: 4 });
    for (let i = 0; i < 600; i++) {
      const id = `leaf${i}`;
      g.addNode(id, { x: i + 1, y: 0, size: 4 });
      g.addEdge("hub", id);
    }

    const original = g.someNeighbor.bind(g);
    let visited = 0;
    vi.spyOn(g, "someNeighbor").mockImplementation((node, predicate) =>
      original(node, (neighbor, attrs) => {
        visited++;
        return predicate(neighbor, attrs);
      }),
    );

    const participants = collectParticipants(g, "hub");
    expect(participants.size).toBe(MAX_PARTICIPANTS);
    // hub occupies one slot, so the early-exiting predicate needs only 399
    // neighbor visits instead of walking the remaining 201 leaves.
    expect(visited).toBe(MAX_PARTICIPANTS - 1);
  });

  it("builds springs and affected edges from participant-local edge walks", () => {
    const g = new Graph();
    const chain = ["a", "b", "c", "d", "e"];
    chain.forEach((id, i) => g.addNode(id, { x: i * 50, y: 0, size: 4 }));
    for (let i = 0; i < chain.length - 1; i++)
      g.addEdge(chain[i]!, chain[i + 1]!);
    for (let i = 0; i < 600; i++) {
      g.addNode(`f${i}`, { x: 2_000 + i, y: 500, size: 4 });
    }
    const unrelated = g.addEdge("f0", "f1");
    g.addNode("hidden", { x: -50, y: 0, size: 4, hidden: true });
    const hiddenEdge = g.addEdge("a", "hidden");
    const bodies = makeBodies(g, "a", (id) => pos(g, id));
    const edgeWalk = vi.spyOn(g, "forEachEdge");

    const network = makeSpringNetwork(g, bodies);

    expect(network.springs).toHaveLength(3); // a-b, b-c, c-d
    expect(network.affectedEdges).toContain(g.edge("d", "e"));
    expect(network.affectedEdges).not.toContain(unrelated);
    expect(network.affectedEdges).not.toContain(hiddenEdge);
    expect(edgeWalk.mock.calls).not.toHaveLength(0);
    expect(
      edgeWalk.mock.calls.every(([first]) => typeof first === "string"),
    ).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import type { DragSim } from "./fluidSim";
import type { FrameLoop } from "./frameLoop";

// Mock the simulation layer so each drag yields a controllable sim whose
// lifecycle calls we can assert on. The real force/settle math is covered by
// fluidSim.test.ts — here we only care that the handler starts, feeds,
// releases, and stops the sim at the right moments.
const startFluidSim = vi.fn();
vi.mock("./fluidSim", () => ({
  startFluidSim: (...args: unknown[]) => startFluidSim(...args),
}));

// Import after the mock is registered.
import { attachDrag } from "./dragHandlers";

type SigmaHandler = (payload: unknown) => void;

/** A fake DragSim recording every method call. */
function makeSim(): DragSim & {
  setDraggedPos: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    setDraggedPos: vi.fn(),
    release: vi.fn(),
    stop: vi.fn(),
  };
}

/**
 * Minimal Sigma stand-in: an event bus (on/off) plus the camera + coordinate
 * helpers the drag handler touches. ``emit`` dispatches a Sigma event the way
 * the renderer would.
 */
function makeSigma() {
  const handlers = new Map<string, Set<SigmaHandler>>();
  const camera = { disable: vi.fn(), enable: vi.fn() };
  const sigma = {
    on: vi.fn((evt: string, h: SigmaHandler) => {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt)!.add(h);
    }),
    off: vi.fn((evt: string, h: SigmaHandler) => {
      handlers.get(evt)?.delete(h);
    }),
    getCamera: () => camera,
    viewportToGraph: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    refresh: vi.fn(),
  } as unknown as Sigma;
  const emit = (evt: string, payload: unknown) => {
    for (const h of handlers.get(evt) ?? []) h(payload);
  };
  return { sigma, emit, camera };
}

function makeGraph(): Graph {
  const g = new Graph();
  g.addNode("a", { x: 0, y: 0 });
  g.addNode("b", { x: 50, y: 0 });
  g.addNode("hidden", { x: 90, y: 0, hidden: true });
  g.addEdge("a", "b");
  return g;
}

function stubFrameLoop(): FrameLoop {
  return {
    add: vi.fn(() => vi.fn()),
    stop: vi.fn(),
    size: 0,
  } as unknown as FrameLoop;
}

interface Harness {
  sim: ReturnType<typeof makeSim>;
  emit: (evt: string, payload: unknown) => void;
  detach: () => void;
  camera: { disable: ReturnType<typeof vi.fn>; enable: ReturnType<typeof vi.fn> };
  frameLoop: FrameLoop;
  cancelTween: ReturnType<typeof vi.fn>;
  onSettled: ReturnType<typeof vi.fn>;
  justDragged: { current: boolean };
}

/** Wire up attachDrag with mocked sim + sigma and return drivers. */
function setup(): Harness {
  const sim = makeSim();
  startFluidSim.mockReturnValue(sim);
  const { sigma, emit, camera } = makeSigma();
  const graph = makeGraph();
  const frameLoop = stubFrameLoop();
  const cancelTween = vi.fn();
  const onSettled = vi.fn();
  const justDragged = { current: false };
  const detach = attachDrag({
    sigma,
    graph,
    frameLoop,
    getSnapTarget: (id) => ({
      x: graph.getNodeAttribute(id, "x") as number,
      y: graph.getNodeAttribute(id, "y") as number,
    }),
    getReleaseMode: () => "sticky",
    onSettled,
    clearHover: vi.fn(),
    cancelTween,
    isDragging: { current: false },
    justDragged,
  });
  return { sim, emit, detach, camera, frameLoop, cancelTween, onSettled, justDragged };
}

function press(h: Pick<Harness, "emit">, node = "a") {
  h.emit("downNode", { node, event: { preventSigmaDefault: vi.fn() } });
}

function move(h: Pick<Harness, "emit">, x = 30, y = 40) {
  h.emit("moveBody", {
    event: {
      x,
      y,
      preventSigmaDefault: vi.fn(),
      original: {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Event,
    },
  });
}

/** Press a node, move it (so it counts as a real drag), then release. */
function dragAndRelease(h: Pick<Harness, "emit">) {
  press(h);
  move(h);
  h.emit("upStage", {});
}

describe("attachDrag — fluid sim lifecycle", () => {
  beforeEach(() => {
    startFluidSim.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a sim on grab, wiring the dragged node and the shared frame loop", () => {
    const h = setup();
    press(h);
    expect(startFluidSim).toHaveBeenCalledTimes(1);
    const args = startFluidSim.mock.calls[0]![0] as {
      draggedId: string;
      frameLoop: FrameLoop;
      getReleaseMode: () => string;
      onSettled: unknown;
    };
    expect(args.draggedId).toBe("a");
    expect(args.frameLoop).toBe(h.frameLoop);
    expect(args.getReleaseMode()).toBe("sticky");
    expect(args.onSettled).toBe(h.onSettled);
    expect(h.camera.disable).toHaveBeenCalled();
    expect(h.cancelTween).toHaveBeenCalled();
  });

  it("feeds cursor moves to the sim as graph coordinates", () => {
    const h = setup();
    press(h);
    move(h, 30, 40);
    expect(h.sim.setDraggedPos).toHaveBeenCalledWith(30, 40);
  });

  it("releases with the drag velocity and re-enables the camera", () => {
    const h = setup();
    press(h);
    move(h, 10, 0);
    move(h, 25, 5);
    h.emit("upNode", {});
    // Velocity = last move minus the previous one.
    expect(h.sim.release).toHaveBeenCalledWith(15, 5);
    expect(h.camera.enable).toHaveBeenCalled();
    // Released sims are left settling — not stopped here.
    expect(h.sim.stop).not.toHaveBeenCalled();
  });

  it("sets justDragged for one tick so the click handler is suppressed", () => {
    const h = setup();
    dragAndRelease(h);
    expect(h.justDragged.current).toBe(true);
    vi.runAllTimers();
    expect(h.justDragged.current).toBe(false);
  });

  it("stops the sim without releasing when the press never moved", () => {
    const h = setup();
    press(h);
    h.emit("upNode", {});
    expect(h.sim.stop).toHaveBeenCalledTimes(1);
    expect(h.sim.release).not.toHaveBeenCalled();
  });

  it("ignores grabs on hidden nodes", () => {
    const h = setup();
    press(h, "hidden");
    expect(startFluidSim).not.toHaveBeenCalled();
    expect(h.camera.disable).not.toHaveBeenCalled();
  });
});

describe("attachDrag — settling teardown", () => {
  beforeEach(() => {
    startFluidSim.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops a still-settling sim when detached mid-settle (structural rebuild)", () => {
    const h = setup();
    dragAndRelease(h);
    expect(h.sim.release).toHaveBeenCalledTimes(1);
    expect(h.sim.stop).not.toHaveBeenCalled();

    // GraphView unmounts / graph rebuilds mid-settle → detach must halt the
    // sim so its frame-loop tick never drives a destroyed Sigma instance.
    h.detach();
    expect(h.sim.stop).toHaveBeenCalledTimes(1);
  });

  it("supersedes a prior settling sim when a new node is grabbed", () => {
    const sim1 = makeSim();
    const sim2 = makeSim();
    startFluidSim.mockReturnValueOnce(sim1).mockReturnValueOnce(sim2);
    const h = setup();
    // setup() armed mockReturnValue; the two mockReturnValueOnce above win first.
    dragAndRelease(h); // releases sim1 → settling
    press(h, "b"); // grabbing again must stop sim1 before starting sim2
    expect(sim1.stop).toHaveBeenCalledTimes(1);
    expect(sim2.stop).not.toHaveBeenCalled();

    h.emit("upNode", {}); // un-moved press → sim2 stopped, not released
    h.detach();
    expect(sim2.stop).toHaveBeenCalled();
  });

  it("stops an in-progress (un-released) drag sim on detach", () => {
    const h = setup();
    press(h);
    h.detach();
    expect(h.sim.stop).toHaveBeenCalledTimes(1);
    expect(h.sim.release).not.toHaveBeenCalled();
  });
});

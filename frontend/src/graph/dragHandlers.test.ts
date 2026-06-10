import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import type { DragSim } from "./physics";

// Mock the physics layer so each drag yields a controllable sim whose stop /
// release we can assert on. The real spring/rAF loop is covered by
// physics.test.ts — here we only care that the handler's lifecycle calls the
// sim's stop() at the right moments.
const startDragSim = vi.fn();
vi.mock("./physics", () => ({
  startDragSim: (...args: unknown[]) => startDragSim(...args),
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
  g.addEdge("a", "b");
  return g;
}

interface Harness {
  sim: ReturnType<typeof makeSim>;
  emit: (evt: string, payload: unknown) => void;
  detach: () => void;
}

/** Wire up attachDrag with mocked physics + sigma and return drivers. */
function setup(): Harness {
  const sim = makeSim();
  startDragSim.mockReturnValue(sim);
  const { sigma, emit } = makeSigma();
  const graph = makeGraph();
  const detach = attachDrag({
    sigma,
    graph,
    getSnapTarget: (id) => ({
      x: graph.getNodeAttribute(id, "x") as number,
      y: graph.getNodeAttribute(id, "y") as number,
    }),
    clearHover: vi.fn(),
    cancelTween: vi.fn(),
    isDragging: { current: false },
    justDragged: { current: false },
  });
  return { sim, emit, detach };
}

/** Press a node, move it (so it counts as a real drag), then release. */
function dragAndRelease(h: Harness) {
  h.emit("downNode", { node: "a", event: { preventSigmaDefault: vi.fn() } });
  h.emit("moveBody", {
    event: {
      x: 30,
      y: 40,
      preventSigmaDefault: vi.fn(),
      original: {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Event,
    },
  });
  h.emit("upStage", {});
}

describe("attachDrag — settling-sim teardown", () => {
  beforeEach(() => {
    startDragSim.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the still-settling sim when detached within the settle window", () => {
    const h = setup();
    dragAndRelease(h);

    // The release handed the sim off to physics' settle loop, which keeps its
    // own rAF chain alive — the handler must NOT have stopped it yet.
    expect(h.sim.release).toHaveBeenCalledTimes(1);
    expect(h.sim.stop).not.toHaveBeenCalled();

    // GraphView unmounts / graph rebuilds mid-settle → detach runs.
    h.detach();

    // Teardown must halt the post-release animation so its rAF loop never runs
    // against a destroyed Sigma instance.
    expect(h.sim.stop).toHaveBeenCalledTimes(1);
  });

  it("drops the settling-sim reference after a natural settle (no detach)", () => {
    const h = setup();
    dragAndRelease(h);
    expect(h.sim.stop).not.toHaveBeenCalled();

    // Let the settle window elapse; the safety timer clears the reference and
    // stops the (already-finished) sim exactly once.
    vi.runAllTimers();
    expect(h.sim.stop).toHaveBeenCalledTimes(1);

    // A later detach must not double-stop the dropped sim.
    h.detach();
    expect(h.sim.stop).toHaveBeenCalledTimes(1);
  });

  it("supersedes a prior settling sim when a new drag is released", () => {
    const sim1 = makeSim();
    const sim2 = makeSim();
    startDragSim.mockReturnValueOnce(sim1).mockReturnValueOnce(sim2);
    const { sigma, emit } = makeSigma();
    const graph = makeGraph();
    const detach = attachDrag({
      sigma,
      graph,
      getSnapTarget: (id) => ({
        x: graph.getNodeAttribute(id, "x") as number,
        y: graph.getNodeAttribute(id, "y") as number,
      }),
      clearHover: vi.fn(),
      cancelTween: vi.fn(),
      isDragging: { current: false },
      justDragged: { current: false },
    });

    const drag = (e: typeof emit) => {
      e("downNode", { node: "a", event: { preventSigmaDefault: vi.fn() } });
      e("moveBody", {
        event: {
          x: 30,
          y: 40,
          preventSigmaDefault: vi.fn(),
          original: {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          } as unknown as Event,
        },
      });
      e("upStage", {});
    };

    drag(emit); // releases sim1 → settling
    // Starting + releasing a second drag must stop sim1 (down stops it, then
    // the new release tracks sim2).
    drag(emit);
    expect(sim1.stop).toHaveBeenCalled();
    expect(sim2.stop).not.toHaveBeenCalled();

    // Detach now stops the current settling sim (sim2).
    detach();
    expect(sim2.stop).toHaveBeenCalledTimes(1);
  });

  it("stops an in-progress (un-released) drag sim on detach", () => {
    const h = setup();
    // Press but never move → not a real drag; sim should be stopped via the
    // non-drag path / detach, not handed to a settle loop.
    h.emit("downNode", { node: "a", event: { preventSigmaDefault: vi.fn() } });
    h.detach();
    expect(h.sim.stop).toHaveBeenCalledTimes(1);
    expect(h.sim.release).not.toHaveBeenCalled();
  });
});

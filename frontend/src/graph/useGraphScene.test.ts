/*
Frontend testing conventions:
- Test behavior, not implementation: render, rerender, assert observable output.
- Mock the heavy layout module so we can observe whether the relayout path runs.

This suite guards the layout-staging hook: a ``notes`` array identity change
that does NOT change graph structure (same sigmaReady, layout, graphFocusId)
must NOT re-run the layout effects — so it can't trigger a fresh ForceAtlas2
pass (applyConstellationLayout with no seed) or a camera recenter, which would
reshuffle the graph and lose the user's pan/zoom and dragged node positions.
*/
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import type { GraphLayout, Note, NoteId } from "../data/types";
import { useGraphScene } from "./useGraphScene";
import {
  applyConstellationLayout,
  computeOrbitScene,
  ORBIT_SCENES,
  type XY,
} from "./layouts";
import { startLayoutTween } from "./layoutTransition";
import type { FrameLoop } from "./frameLoop";
import type { TweenHandle } from "./layoutTransition";

// Stub the layout module: applyConstellationLayout is the fresh-FA2 path we
// must NOT hit on an irrelevant notes change; computeOrbitScene feeds the
// scene layouts. easeInOutCubic passes through (real) for the camera animate.
vi.mock("./layouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./layouts")>();
  return {
    ...actual,
    applyConstellationLayout: vi.fn(() => new Map<string, XY>()),
    computeOrbitScene: vi.fn(() => new Map<string, XY>()),
  };
});

// Stub the tween so scene layouts do not touch a real frame loop / camera.
vi.mock("./layoutTransition", () => ({
  startLayoutTween: vi.fn(
    (): TweenHandle => ({ cancel: vi.fn() }) as unknown as TweenHandle,
  ),
}));

const applyMock = vi.mocked(applyConstellationLayout);
const orbitMock = vi.mocked(computeOrbitScene);
const tweenMock = vi.mocked(startLayoutTween);

function ref<T>(current: T): { current: T } {
  return { current };
}

function note(id: string, links: string[] = []): Note {
  return {
    id: id as NoteId,
    title: id,
    type: "topic",
    links: links as NoteId[],
  } as unknown as Note;
}

/** A real graphology graph mirroring the notes, so scene/constellation reads
 * work against actual node data. */
function buildGraph(notes: Note[]): Graph {
  const g = new Graph();
  for (const n of notes) g.addNode(n.id, { noteType: n.type, x: 0, y: 0 });
  for (const n of notes) {
    for (const l of n.links) {
      if (g.hasNode(l) && !g.hasEdge(n.id, l)) g.addEdge(n.id, l);
    }
  }
  return g;
}

/** Minimal Sigma stub: just the camera surface the effect drives. */
function stubSigma(): { sigma: Sigma; animate: ReturnType<typeof vi.fn> } {
  const animate = vi.fn();
  const camera = { animate };
  const sigma = {
    getCamera: () => camera,
    refresh: vi.fn(),
  } as unknown as Sigma;
  return { sigma, animate };
}

function stubFrameLoop(): FrameLoop {
  return {
    add: vi.fn(() => vi.fn()),
    stop: vi.fn(),
  } as unknown as FrameLoop;
}

interface Harness {
  layout: GraphLayout;
  graphFocusId: NoteId | null;
  notes: Note[];
  sigmaReady: number;
  layoutAutoCycle?: boolean;
}

function setup(initial: Harness, graph: Graph) {
  const { sigma, animate } = stubSigma();
  const args = {
    sigmaRef: ref<Sigma | null>(sigma),
    graphRef: ref<Graph | null>(graph),
    frameLoopRef: ref<FrameLoop | null>(stubFrameLoop()),
    activeTweenRef: ref<TweenHandle | null>(null),
    orbitTargetsRef: ref(new Map<string, XY>()),
    basePositionsRef: ref(new Map<string, XY>()),
    spacingScaleRef: ref(1),
  };
  const view = renderHook(
    (props: Harness) =>
      useGraphScene({
        ...args,
        layoutAutoCycle: false,
        ...props,
      }),
    { initialProps: initial },
  );
  return { ...view, animate, sigmaRef: args.sigmaRef };
}

describe("useGraphScene — relayout stability on notes identity change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT re-run the fresh force layout when notes changes identity but structure is unchanged", () => {
    const notesA = [note("a", ["b"]), note("b"), note("c")];
    const graph = buildGraph(notesA);

    const { rerender, animate } = setup(
      { layout: "force", graphFocusId: null, notes: notesA, sigmaReady: 1 },
      graph,
    );

    // First render is a fresh build (sigmaReady bumped from -1 → 1): the
    // force branch short-circuits on isFreshBuild and does NOT call
    // applyConstellationLayout; it only recenters once.
    const callsAfterBuild = applyMock.mock.calls.length;
    const recenterAfterBuild = animate.mock.calls.length;

    // Now: rename / drag-move yields a brand-new notes array with identical
    // structure. sigmaReady, layout, graphFocusId all unchanged.
    const notesB = [note("a", ["b"]), note("b"), note("c")];
    expect(notesB).not.toBe(notesA); // genuinely new identity
    rerender({
      layout: "force",
      graphFocusId: null,
      notes: notesB,
      sigmaReady: 1,
    });

    // The effect must NOT have re-run: no new fresh-layout call, no recenter.
    expect(applyMock.mock.calls.length).toBe(callsAfterBuild);
    expect(animate.mock.calls.length).toBe(recenterAfterBuild);
  });

  it("DOES re-run the force relayout when switching back from a scene layout", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { rerender, animate } = setup(
      { layout: "force", graphFocusId: null, notes, sigmaReady: 1 },
      graph,
    );

    const applyBefore = applyMock.mock.calls.length;
    const animateBefore = animate.mock.calls.length;

    rerender({ layout: "rings", graphFocusId: "a" as NoteId, notes, sigmaReady: 1 });
    rerender({ layout: "force", graphFocusId: null, notes, sigmaReady: 1 });

    // Returning to force with prevReady === sigmaReady is NOT a fresh build,
    // so the effect runs applyConstellationLayout (fresh-FA2 path) + recenter
    // — exactly the behavior a real layout switch relies on.
    expect(applyMock.mock.calls.length).toBeGreaterThan(applyBefore);
    expect(animate.mock.calls.length).toBeGreaterThan(animateBefore);
  });

  it("uses notes[0] as the scene focus fallback via a ref (no notes dependency needed)", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    setup({ layout: "rings", graphFocusId: null, notes, sigmaReady: 1 }, graph);

    // graphFocusId is null → focus falls back to notes[0].id === "a".
    expect(orbitMock).toHaveBeenCalled();
    const focusArg = orbitMock.mock.calls[0]?.[1];
    expect(focusArg).toBe("a");
    expect(tweenMock).toHaveBeenCalled();
  });

  it("does NOT restart the layout cycle when notes changes identity but focus/layout/ready are unchanged", () => {
    const notesA = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notesA);

    const { rerender } = setup(
      { layout: "rings", graphFocusId: "a" as NoteId, notes: notesA, sigmaReady: 1 },
      graph,
    );

    const tweensAfterFirst = tweenMock.mock.calls.length;

    // New notes identity, same structure/focus/layout/ready.
    const notesB = [note("a", ["b"]), note("b")];
    rerender({
      layout: "rings",
      graphFocusId: "a" as NoteId,
      notes: notesB,
      sigmaReady: 1,
    });

    // Effect did not re-run → no extra scene tween kicked off, interval not
    // re-armed.
    expect(tweenMock.mock.calls.length).toBe(tweensAfterFirst);
  });
});

describe("useGraphScene — layout selection & auto-cycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the selected scene layout and returns it for the caption", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { result } = setup(
      { layout: "galaxy", graphFocusId: "a" as NoteId, notes, sigmaReady: 1 },
      graph,
    );

    expect(orbitMock).toHaveBeenCalledWith(graph, "a", "galaxy");
    expect(result.current).toBe("galaxy");
  });

  it("tweens to the newly picked layout when the selection changes", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { rerender, result } = setup(
      { layout: "rings", graphFocusId: "a" as NoteId, notes, sigmaReady: 1 },
      graph,
    );
    const tweensBefore = tweenMock.mock.calls.length;

    rerender({
      layout: "wave",
      graphFocusId: "a" as NoteId,
      notes,
      sigmaReady: 1,
    });

    expect(orbitMock).toHaveBeenCalledWith(graph, "a", "wave");
    expect(tweenMock.mock.calls.length).toBeGreaterThan(tweensBefore);
    expect(result.current).toBe("wave");
  });

  it("stays on the selected layout when auto-cycle is off", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { result } = setup(
      {
        layout: "spiral",
        graphFocusId: "a" as NoteId,
        notes,
        sigmaReady: 1,
        layoutAutoCycle: false,
      },
      graph,
    );
    const tweensAfterFirst = tweenMock.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(tweenMock.mock.calls.length).toBe(tweensAfterFirst);
    expect(result.current).toBe("spiral");
  });

  it("walks to the next scene from the selected layout when auto-cycle is on", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { result } = setup(
      {
        layout: "spiral",
        graphFocusId: "a" as NoteId,
        notes,
        sigmaReady: 1,
        layoutAutoCycle: true,
      },
      graph,
    );
    expect(result.current).toBe("spiral");

    act(() => {
      vi.advanceTimersByTime(9_000);
    });

    const after = ORBIT_SCENES[(ORBIT_SCENES.indexOf("spiral") + 1) % ORBIT_SCENES.length];
    expect(result.current).toBe(after);
    expect(orbitMock).toHaveBeenCalledWith(graph, "a", after);
  });

  it("does NOT kick a force relayout when focus or cycle toggles change in force layout", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { rerender, animate } = setup(
      { layout: "force", graphFocusId: null, notes, sigmaReady: 1 },
      graph,
    );
    const applyBefore = applyMock.mock.calls.length;
    const animateBefore = animate.mock.calls.length;

    rerender({
      layout: "force",
      graphFocusId: "a" as NoteId,
      notes,
      sigmaReady: 1,
      layoutAutoCycle: true,
    });

    // The force effect is blind to focus/auto-cycle — no relayout, no
    // recenter, and no scene tween either (layout isn't a scene).
    expect(applyMock.mock.calls.length).toBe(applyBefore);
    expect(animate.mock.calls.length).toBe(animateBefore);
    expect(tweenMock).not.toHaveBeenCalled();
  });

  it("falls back to the first present note when the focused node left the graph", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    // Focus a node that was removed by a rebuild (not in the graph anymore).
    setup(
      { layout: "rings", graphFocusId: "ghost" as NoteId, notes, sigmaReady: 1 },
      graph,
    );

    // No graphology throw; the scene stages around the first present note.
    expect(orbitMock).toHaveBeenCalled();
    expect(orbitMock.mock.calls[0]?.[1]).toBe("a");
  });

  it("stops the auto-cycle from driving a torn-down instance", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { sigmaRef } = setup(
      {
        layout: "rings",
        graphFocusId: "a" as NoteId,
        notes,
        sigmaReady: 1,
        layoutAutoCycle: true,
      },
      graph,
    );
    const tweensAfterFirst = tweenMock.mock.calls.length;

    // Simulate the build effect killing the instance (e.g. the vault emptied)
    // without a sigmaReady bump — the interval is still armed.
    sigmaRef.current = null;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // The stale-instance guard must keep late ticks from staging new tweens.
    expect(tweenMock.mock.calls.length).toBe(tweensAfterFirst);
  });
});

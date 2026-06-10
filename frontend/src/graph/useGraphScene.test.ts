/*
Frontend testing conventions:
- Test behavior, not implementation: render, rerender, assert observable output.
- Mock the heavy layout module so we can observe whether the relayout path runs.

This suite guards the MEDIUM bug fix in useGraphScene: a ``notes`` array
identity change that does NOT change graph structure (same sigmaReady,
graphMode, graphFocusId) must NOT re-run the relayout effect — so it can't
trigger a fresh ForceAtlas2 pass (applyConstellationLayout with no seed) or a
camera recenter, which would reshuffle the graph and lose the user's pan/zoom
and dragged node positions.
*/
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import type { GraphMode, Note, NoteId } from "../data/types";
import { useGraphScene } from "./useGraphScene";
import {
  applyConstellationLayout,
  computeOrbitScene,
  type XY,
} from "./layouts";
import { startLayoutTween } from "./layoutTransition";
import type { FrameLoop } from "./frameLoop";
import type { TweenHandle } from "./layoutTransition";

// Stub the layout module: applyConstellationLayout is the fresh-FA2 path we
// must NOT hit on an irrelevant notes change; computeOrbitScene feeds orbit
// mode. easeInOutCubic is re-exported through (real) for the camera animate.
vi.mock("./layouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./layouts")>();
  return {
    ...actual,
    applyConstellationLayout: vi.fn(() => new Map<string, XY>()),
    computeOrbitScene: vi.fn(() => new Map<string, XY>()),
  };
});

// Stub the tween so orbit mode does not touch a real frame loop / sigma camera.
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

/** A real graphology graph mirroring the notes, so orbit/constellation reads
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
  graphMode: GraphMode;
  graphFocusId: NoteId | null;
  notes: Note[];
  sigmaReady: number;
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
  const view = renderHook((props: Harness) => useGraphScene({ ...args, ...props }), {
    initialProps: initial,
  });
  return { ...view, animate };
}

describe("useGraphScene — relayout stability on notes identity change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT re-run the fresh constellation layout when notes changes identity but structure is unchanged", () => {
    const notesA = [note("a", ["b"]), note("b"), note("c")];
    const graph = buildGraph(notesA);

    const { rerender, animate } = setup(
      { graphMode: "constellation", graphFocusId: null, notes: notesA, sigmaReady: 1 },
      graph,
    );

    // First render is a fresh build (sigmaReady bumped from -1 → 1): the
    // constellation branch short-circuits on isFreshBuild and does NOT call
    // applyConstellationLayout; it only recenters once.
    const callsAfterBuild = applyMock.mock.calls.length;
    const recenterAfterBuild = animate.mock.calls.length;

    // Now: rename / drag-move yields a brand-new notes array with identical
    // structure. sigmaReady, graphMode, graphFocusId all unchanged.
    const notesB = [note("a", ["b"]), note("b"), note("c")];
    expect(notesB).not.toBe(notesA); // genuinely new identity
    rerender({
      graphMode: "constellation",
      graphFocusId: null,
      notes: notesB,
      sigmaReady: 1,
    });

    // The effect must NOT have re-run: no new fresh-layout call, no recenter.
    expect(applyMock.mock.calls.length).toBe(callsAfterBuild);
    expect(animate.mock.calls.length).toBe(recenterAfterBuild);
  });

  it("DOES re-run the constellation relayout on a genuine structural rebuild (sigmaReady bump → not fresh)", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    const { rerender, animate } = setup(
      { graphMode: "constellation", graphFocusId: null, notes, sigmaReady: 1 },
      graph,
    );

    // Drive sigmaReady forward twice so the effect sees a *stable* prevReady and
    // a non-fresh run takes the applyConstellationLayout branch. First bump is
    // "fresh" (skips apply); a same-value rerender that re-runs the effect for
    // another reason would be non-fresh. We simulate the non-fresh constellation
    // path by toggling graphMode out and back so the effect re-runs with the
    // already-recorded sigmaReady.
    const applyBefore = applyMock.mock.calls.length;
    const animateBefore = animate.mock.calls.length;

    rerender({ graphMode: "orbit", graphFocusId: "a" as NoteId, notes, sigmaReady: 1 });
    rerender({ graphMode: "constellation", graphFocusId: null, notes, sigmaReady: 1 });

    // Returning to constellation with prevReady === sigmaReady is NOT a fresh
    // build, so the effect runs applyConstellationLayout (fresh-FA2 path) +
    // recenter — exactly the behavior a real structural change relies on.
    expect(applyMock.mock.calls.length).toBeGreaterThan(applyBefore);
    expect(animate.mock.calls.length).toBeGreaterThan(animateBefore);
  });

  it("uses notes[0] as the orbit focus fallback via a ref (no notes dependency needed)", () => {
    const notes = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notes);

    setup(
      { graphMode: "orbit", graphFocusId: null, notes, sigmaReady: 1 },
      graph,
    );

    // graphFocusId is null → focus falls back to notes[0].id === "a".
    expect(orbitMock).toHaveBeenCalled();
    const focusArg = orbitMock.mock.calls[0]?.[1];
    expect(focusArg).toBe("a");
    expect(tweenMock).toHaveBeenCalled();
  });

  it("does NOT restart the orbit cycle when notes changes identity but focus/mode/ready are unchanged", () => {
    const notesA = [note("a", ["b"]), note("b")];
    const graph = buildGraph(notesA);

    const { rerender } = setup(
      { graphMode: "orbit", graphFocusId: "a" as NoteId, notes: notesA, sigmaReady: 1 },
      graph,
    );

    const tweensAfterFirst = tweenMock.mock.calls.length;

    // New notes identity, same structure/focus/mode/ready.
    const notesB = [note("a", ["b"]), note("b")];
    rerender({
      graphMode: "orbit",
      graphFocusId: "a" as NoteId,
      notes: notesB,
      sigmaReady: 1,
    });

    // Effect did not re-run → no extra scene tween kicked off, interval not
    // re-armed.
    expect(tweenMock.mock.calls.length).toBe(tweensAfterFirst);
  });
});

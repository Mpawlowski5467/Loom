import { useEffect, useRef, useState } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { GraphLayout, Note, NoteId } from "../data/types";
import {
  applyConstellationLayout,
  computeOrbitScene,
  easeInOutCubic,
  ORBIT_SCENES,
  type OrbitScene,
  type XY,
} from "./layouts";
import { startLayoutTween, type TweenHandle } from "./layoutTransition";
import { spacingToCameraRatio } from "./reducers";
import type { FrameLoop } from "./frameLoop";

interface Ref<T> {
  current: T;
}

const SCENE_HOLD_MS = 9000;
const SCENE_TWEEN_MS = 1200;

/**
 * Stages the selected layout. "force" short-circuits to the force-directed
 * constellation layout (FA2 relayout on a switch back, never on a fresh
 * build). Any other layout is an orbit scene (Rings / Spiral / Arms / Galaxy /
 * Wave) tweened via the shared frame loop; with auto-cycle on the five scene
 * layouts are walked from the selected one every ``SCENE_HOLD_MS``. Returns
 * the scene currently on stage for the on-canvas caption.
 */
export function useGraphScene(args: {
  sigmaRef: Ref<Sigma | null>;
  graphRef: Ref<Graph | null>;
  frameLoopRef: Ref<FrameLoop | null>;
  activeTweenRef: Ref<TweenHandle | null>;
  orbitTargetsRef: Ref<Map<string, XY>>;
  basePositionsRef: Ref<Map<string, XY>>;
  spacingScaleRef: Ref<number>;
  /** Halts any settling drag sim before staging a layout (see below). */
  stopDragSimRef?: Ref<(() => void) | null>;
  layout: GraphLayout;
  graphFocusId: NoteId | null;
  notes: Note[];
  sigmaReady: number;
  layoutAutoCycle: boolean;
}): OrbitScene {
  const {
    sigmaRef,
    graphRef,
    frameLoopRef,
    activeTweenRef,
    orbitTargetsRef,
    basePositionsRef,
    spacingScaleRef,
    stopDragSimRef,
    layout,
    graphFocusId,
    notes,
    sigmaReady,
    layoutAutoCycle,
  } = args;

  const [stagedScene, setStagedScene] = useState<OrbitScene>(
    layout === "force" ? "rings" : layout,
  );
  const prevReadyRef = useRef(-1);
  // Latest notes, readable from the effect without making ``notes`` a
  // dependency. The effect only needs notes for the scene-layout focus
  // fallback (notes[0]?.id); keeping the array out of the deps means a notes
  // identity change that leaves graph structure intact (e.g. a rename or
  // drag-move producing a new array with the same structural key) does NOT
  // re-run this effect — so it can't trigger a fresh ForceAtlas2 relayout or a
  // camera recenter on the force branch.
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;

  const recenter = (sigma: Sigma): void => {
    sigma.getCamera().animate(
      { ratio: spacingToCameraRatio(spacingScaleRef.current), x: 0.5, y: 0.5 },
      { duration: 600, easing: easeInOutCubic },
    );
  };

  // Force branch. Deliberately blind to the scene-only deps (graphFocusId,
  // layoutAutoCycle) so focusing a node or toggling the cycle while in the
  // force layout can't kick a ForceAtlas2 relayout.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    // A bumped sigmaReady means the graph was just (re)built and is already
    // laid out — don't re-run ForceAtlas2 on the force branch. The ref
    // updates on every run (any layout) so a later layout switch isn't
    // mistaken for a fresh build.
    const isFreshBuild = sigmaReady !== prevReadyRef.current;
    prevReadyRef.current = sigmaReady;

    if (layout !== "force") return;

    // A drag sim still settling from the previous layout would fight the
    // relayout below and then persist mixed positions as new homes — halt it
    // first (stop() completes the settle instantly, keeping homes coherent).
    stopDragSimRef?.current?.();
    activeTweenRef.current?.cancel();
    activeTweenRef.current = null;

    if (!isFreshBuild) {
      basePositionsRef.current = applyConstellationLayout(graph);
      orbitTargetsRef.current = new Map();
      sigma.refresh();
    }
    recenter(sigma);
    // ``notes`` is intentionally NOT a dependency — see notesRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, sigmaReady]);

  // Scene branch: stage the selected scene layout, optionally cycling onward.
  useEffect(() => {
    if (layout === "force") return;
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    const frameLoop = frameLoopRef.current;
    if (!sigma || !graph || !frameLoop) return;

    // The clicked focus can outlive its node (e.g. an agent archives the note
    // and the SSE refetch rebuilds without it) — staging an unknown node would
    // throw inside graphology's BFS. Fall back to the first present note.
    const focusId =
      graphFocusId && graph.hasNode(graphFocusId)
        ? graphFocusId
        : notesRef.current.find((n) => graph.hasNode(n.id))?.id;
    if (!focusId) return;

    const playScene = (scene: OrbitScene): void => {
      // The build effect can tear the instance down without bumping
      // sigmaReady (e.g. the vault emptied), leaving the auto-cycle interval
      // alive — a late tick must not drive a killed renderer.
      if (sigmaRef.current !== sigma) return;
      setStagedScene(scene);
      // Same as the force branch: a still-settling drag sim would write
      // positions against the tween every frame and then re-home to whatever
      // mid-tween state it stopped in — halt it before staging.
      stopDragSimRef?.current?.();
      const targets = computeOrbitScene(graph, focusId, scene);
      orbitTargetsRef.current = targets;
      activeTweenRef.current?.cancel();
      activeTweenRef.current = startLayoutTween({
        sigma,
        graph,
        targets,
        frameLoop,
        duration: SCENE_TWEEN_MS,
        onComplete: () => recenter(sigma),
      });
    };

    let sceneIdx = Math.max(0, ORBIT_SCENES.indexOf(layout));
    playScene(ORBIT_SCENES[sceneIdx]!);

    let interval: number | undefined;
    if (layoutAutoCycle) {
      interval = window.setInterval(() => {
        sceneIdx = (sceneIdx + 1) % ORBIT_SCENES.length;
        playScene(ORBIT_SCENES[sceneIdx]!);
      }, SCENE_HOLD_MS);
    }

    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      activeTweenRef.current?.cancel();
      activeTweenRef.current = null;
    };
    // ``notes`` is intentionally NOT a dependency — see notesRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, graphFocusId, sigmaReady, layoutAutoCycle]);

  return stagedScene;
}

import { useEffect, useRef, useState } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { GraphMode, Note, NoteId } from "../data/types";
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
 * Orbit mode plays the user-selected layout "scene" (Rings / Spiral / Arms /
 * Galaxy / Wave), tweening transitions via the shared frame loop; with
 * auto-cycle on it walks the whole set from the selected scene every
 * ``SCENE_HOLD_MS``. Constellation mode short-circuits to the force-directed
 * layout. Returns the scene currently on stage for the on-canvas caption.
 */
export function useGraphScene(args: {
  sigmaRef: Ref<Sigma | null>;
  graphRef: Ref<Graph | null>;
  frameLoopRef: Ref<FrameLoop | null>;
  activeTweenRef: Ref<TweenHandle | null>;
  orbitTargetsRef: Ref<Map<string, XY>>;
  basePositionsRef: Ref<Map<string, XY>>;
  spacingScaleRef: Ref<number>;
  graphMode: GraphMode;
  graphFocusId: NoteId | null;
  notes: Note[];
  sigmaReady: number;
  orbitScene: OrbitScene;
  orbitAutoCycle: boolean;
}): OrbitScene {
  const {
    sigmaRef,
    graphRef,
    frameLoopRef,
    activeTweenRef,
    orbitTargetsRef,
    basePositionsRef,
    spacingScaleRef,
    graphMode,
    graphFocusId,
    notes,
    sigmaReady,
    orbitScene,
    orbitAutoCycle,
  } = args;

  const [stagedScene, setStagedScene] = useState<OrbitScene>(orbitScene);
  const prevReadyRef = useRef(-1);
  // Latest notes, readable from the effect without making ``notes`` a
  // dependency. The effect only needs notes for the orbit-mode focus fallback
  // (notes[0]?.id); keeping the array out of the deps means a notes-array
  // identity change that leaves graph structure intact (e.g. a rename or
  // drag-move producing a new array with the same structural key) does NOT
  // re-run this effect — so it can't trigger a fresh ForceAtlas2 relayout or a
  // camera recenter on the constellation branch.
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;

  const recenter = (sigma: Sigma): void => {
    sigma.getCamera().animate(
      { ratio: spacingToCameraRatio(spacingScaleRef.current), x: 0.5, y: 0.5 },
      { duration: 600, easing: easeInOutCubic },
    );
  };

  // Constellation branch. Deliberately blind to the orbit-only deps
  // (graphFocusId, orbitScene, orbitAutoCycle) so picking a scene or focus
  // while in constellation mode can't kick a ForceAtlas2 relayout.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    // A bumped sigmaReady means the graph was just (re)built and is already
    // laid out — don't re-run ForceAtlas2 on the constellation branch. The
    // ref updates on every run (either mode) so a later mode switch isn't
    // mistaken for a fresh build.
    const isFreshBuild = sigmaReady !== prevReadyRef.current;
    prevReadyRef.current = sigmaReady;

    if (graphMode === "orbit") return;

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
  }, [graphMode, sigmaReady]);

  // Orbit branch: stage the selected scene, optionally auto-cycling onward.
  useEffect(() => {
    if (graphMode !== "orbit") return;
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

    let sceneIdx = Math.max(0, ORBIT_SCENES.indexOf(orbitScene));
    playScene(ORBIT_SCENES[sceneIdx]!);

    let interval: number | undefined;
    if (orbitAutoCycle) {
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
  }, [graphMode, graphFocusId, sigmaReady, orbitScene, orbitAutoCycle]);

  return stagedScene;
}

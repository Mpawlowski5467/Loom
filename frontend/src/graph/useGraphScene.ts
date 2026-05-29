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
 * Orbit mode's auto-cycle: walk a curated set of layout "scenes" (Rings →
 * Spiral → Arms) on a timer, tweening between them via the shared frame loop.
 * Constellation mode short-circuits to the force-directed layout. Returns the
 * current scene name for the on-canvas caption.
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
  } = args;

  const [orbitScene, setOrbitScene] = useState<OrbitScene>("rings");
  const prevReadyRef = useRef(-1);

  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    const frameLoop = frameLoopRef.current;
    if (!sigma || !graph || !frameLoop) return;

    // A bumped sigmaReady means the graph was just (re)built and is already
    // laid out — don't re-run ForceAtlas2 on the constellation branch.
    const isFreshBuild = sigmaReady !== prevReadyRef.current;
    prevReadyRef.current = sigmaReady;

    activeTweenRef.current?.cancel();
    activeTweenRef.current = null;

    const recenter = (): void => {
      sigma.getCamera().animate(
        { ratio: spacingToCameraRatio(spacingScaleRef.current), x: 0.5, y: 0.5 },
        { duration: 600, easing: easeInOutCubic },
      );
    };

    if (graphMode !== "orbit") {
      if (!isFreshBuild) {
        basePositionsRef.current = applyConstellationLayout(graph);
        orbitTargetsRef.current = new Map();
        sigma.refresh();
      }
      recenter();
      return;
    }

    const focusId = graphFocusId ?? notes[0]?.id;
    if (!focusId) return;
    let sceneIdx = 0;

    const playScene = (idx: number): void => {
      const scene = ORBIT_SCENES[idx]!;
      setOrbitScene(scene);
      const targets = computeOrbitScene(graph, focusId, scene);
      orbitTargetsRef.current = targets;
      activeTweenRef.current?.cancel();
      activeTweenRef.current = startLayoutTween({
        sigma,
        graph,
        targets,
        frameLoop,
        duration: SCENE_TWEEN_MS,
        onComplete: recenter,
      });
    };

    playScene(sceneIdx);

    const interval = window.setInterval(() => {
      sceneIdx = (sceneIdx + 1) % ORBIT_SCENES.length;
      playScene(sceneIdx);
    }, SCENE_HOLD_MS);

    return () => {
      window.clearInterval(interval);
      activeTweenRef.current?.cancel();
      activeTweenRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphMode, graphFocusId, notes, sigmaReady]);

  return orbitScene;
}

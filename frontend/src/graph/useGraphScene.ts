import { useEffect, useRef, useState } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { GraphLayout, Note, NoteId, NodeType } from "../data/types";
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
import {
  computePositionBBox,
  computeVisibleGraphBBox,
  graphVisibilityIsRestricted,
} from "./filtering";

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
 * the scene currently on stage for the on-canvas caption. When nodes are
 * added or removed in place (``structureVersion``), the scene on stage is
 * restaged so new nodes take a slot, without recentering the camera.
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
  selectedNodeId?: NoteId | null;
  isolateNeighbors?: boolean;
  notes: Note[];
  sigmaReady: number;
  /** Bumps when nodes/edges changed in place (no rebuild). */
  structureVersion?: number;
  layoutAutoCycle: boolean;
  graphFilters: Set<NodeType>;
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
    selectedNodeId = null,
    isolateNeighbors = false,
    notes,
    sigmaReady,
    structureVersion = 0,
    layoutAutoCycle,
    graphFilters,
  } = args;
  const filterKey = [...graphFilters].sort().join("|");
  const requestedFocusId = selectedNodeId ?? graphFocusId;
  const visibilityKey = `${filterKey}::${
    isolateNeighbors ? (selectedNodeId ?? "none") : "all"
  }`;

  const [stagedScene, setStagedScene] = useState<OrbitScene>(
    layout === "force" ? "rings" : layout,
  );
  const prevReadyRef = useRef(-1);
  // Scene-effect bookkeeping that tells a structure-only restage (same
  // layout, focus, build, cycle and visibility) apart from a user change.
  const stageKeyRef = useRef("");
  const prevStructureRef = useRef(structureVersion);
  const onStageRef = useRef<OrbitScene | null>(null);
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
      {
        ratio: spacingToCameraRatio(spacingScaleRef.current),
        x: 0.5,
        y: 0.5,
      },
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
      sigma.setCustomBBox(
        graphVisibilityIsRestricted(graph)
          ? computeVisibleGraphBBox(graph)
          : null,
      );
      sigma.refresh();
    }
    recenter(sigma);
    // ``notes`` is intentionally NOT a dependency — see notesRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, sigmaReady]);

  // Scene branch: stage the selected scene layout, optionally cycling onward.
  useEffect(() => {
    const stageKey = [
      layout,
      requestedFocusId,
      sigmaReady,
      layoutAutoCycle,
      visibilityKey,
    ].join("|");
    const structureOnly =
      structureVersion !== prevStructureRef.current &&
      stageKey === stageKeyRef.current;
    stageKeyRef.current = stageKey;
    prevStructureRef.current = structureVersion;
    if (layout === "force") return;
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    const frameLoop = frameLoopRef.current;
    if (!sigma || !graph || !frameLoop) return;

    // The clicked focus can outlive its node (e.g. an agent archives the note
    // and the SSE refetch rebuilds without it) — staging an unknown node would
    // throw inside graphology's BFS. Fall back to the first present note.
    const focusId =
      requestedFocusId &&
      graph.hasNode(requestedFocusId) &&
      !graph.getNodeAttribute(requestedFocusId, "hidden")
        ? requestedFocusId
        : notesRef.current.find(
            (n) =>
              graph.hasNode(n.id) && !graph.getNodeAttribute(n.id, "hidden"),
          )?.id;
    if (!focusId) return;

    const playScene = (scene: OrbitScene, recenterAfter: boolean): void => {
      // The build effect can tear the instance down without bumping
      // sigmaReady (e.g. the vault emptied), leaving the auto-cycle interval
      // alive — a late tick must not drive a killed renderer.
      if (sigmaRef.current !== sigma) return;
      setStagedScene(scene);
      onStageRef.current = scene;
      // Same as the force branch: a still-settling drag sim would write
      // positions against the tween every frame and then re-home to whatever
      // mid-tween state it stopped in — halt it before staging.
      stopDragSimRef?.current?.();
      const targets = computeOrbitScene(graph, focusId, scene);
      orbitTargetsRef.current = targets;
      sigma.setCustomBBox(
        graphVisibilityIsRestricted(graph)
          ? computePositionBBox(targets.values())
          : null,
      );
      activeTweenRef.current?.cancel();
      activeTweenRef.current = startLayoutTween({
        sigma,
        graph,
        targets,
        frameLoop,
        duration: SCENE_TWEEN_MS,
        onComplete: recenterAfter ? () => recenter(sigma) : undefined,
      });
    };

    // A structure-only restage keeps the scene the cycle is on and leaves
    // the camera where the user put it.
    const startScene =
      structureOnly && onStageRef.current ? onStageRef.current : layout;
    let sceneIdx = Math.max(0, ORBIT_SCENES.indexOf(startScene));
    playScene(ORBIT_SCENES[sceneIdx]!, !structureOnly);

    let interval: number | undefined;
    if (layoutAutoCycle) {
      interval = window.setInterval(() => {
        sceneIdx = (sceneIdx + 1) % ORBIT_SCENES.length;
        playScene(ORBIT_SCENES[sceneIdx]!, true);
      }, SCENE_HOLD_MS);
    }

    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      activeTweenRef.current?.cancel();
      activeTweenRef.current = null;
    };
    // ``notes`` is intentionally NOT a dependency — see notesRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    layout,
    requestedFocusId,
    sigmaReady,
    structureVersion,
    layoutAutoCycle,
    visibilityKey,
  ]);

  return stagedScene;
}

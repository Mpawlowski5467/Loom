import { useEffect, useMemo, useRef, useState } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { GraphDisplay } from "../context/app-ctx";
import type { Note, NoteId } from "../data/types";
import { createSigma } from "./sigma-setup";
import { buildGraph } from "./graphModel";
import { collectNodeZ } from "./depth";
import { applyConstellationLayout, easeInOutCubic, type XY } from "./layouts";
import { structuralKey, contentKey } from "./graphKeys";
import {
  patchGraphContent,
  syncGraphStructure,
  type GraphSyncResult,
} from "./graphSync";
import { attachDrag } from "./dragHandlers";
import { createFrameLoop, type FrameLoop } from "./frameLoop";
import {
  computeEdgeExtremities,
  makeEdgeReducer,
  makeNodeReducer,
  ratioToTier,
} from "./reducers";
import { createTravelers } from "./travelers";
import { wireSigmaEvents } from "./sigmaEvents";
import { createLens } from "./lens";
import { GRAPH_LABEL_BUDGET_NODES, type GraphTuning } from "./tuning";
import type { TweenHandle } from "./layoutTransition";
import { applyGraphVisibility, computeVisibleDegreeMap } from "./filtering";
import { installGraphDebugHook } from "./graphDebug";

interface Ref<T> {
  current: T;
}

// Above this node count the permanent animation loops (travelers, breathing,
// lens) are not registered — the graph stays static so large vaults don't
// stutter. Tunable.
export const PERF_BUDGET_NODES = GRAPH_LABEL_BUDGET_NODES;

export interface GraphInstance {
  sigmaRef: Ref<Sigma | null>;
  graphRef: Ref<Graph | null>;
  frameLoopRef: Ref<FrameLoop | null>;
  baseSizesRef: Ref<Map<string, number>>;
  basePositionsRef: Ref<Map<string, XY>>;
  orbitTargetsRef: Ref<Map<string, XY>>;
  activeTweenRef: Ref<TweenHandle | null>;
  breathingRemoveRef: Ref<(() => void) | null>;
  /** Halts the active drag sim (scene staging calls it before a tween). */
  stopDragSimRef: Ref<(() => void) | null>;
  /** Bumps on every full (re)build — the graph is freshly laid out. */
  sigmaReady: number;
  /** Bumps when nodes/edges were added or removed in place. */
  structureVersion: number;
  building: boolean;
}

/**
 * Owns the imperative Sigma instance: builds the graph + renderer, wires the
 * reducers, node events, drag, the shared frame loop, and the travelers/lens
 * overlay, then tears it all down on cleanup. The heavy build (ForceAtlas2) is
 * deferred one frame so the loading shimmer can paint first. After that the
 * instance lives for as long as there are notes: structural changes are
 * diffed onto the live graph (graphSync.ts) instead of rebuilding, so the
 * camera, reducers, frame loop and overlays survive. Returns the live handles
 * the rest of GraphView's hooks/effects read.
 */
export function useGraphInstance(args: {
  notes: Note[];
  hostRef: Ref<HTMLDivElement | null>;
  overlayRef: Ref<SVGSVGElement | null>;
  tuningRef: Ref<GraphTuning>;
  graphDisplayRef: Ref<GraphDisplay>;
  openNote: (id: NoteId) => void;
  onEdgeClick?: (sourceId: NoteId, targetId: NoteId) => void;
  setGraphFocusId: (id: NoteId | null) => void;
  setGraphSelectedId: (id: NoteId | null) => void;
}): GraphInstance {
  const {
    notes,
    hostRef,
    overlayRef,
    tuningRef,
    graphDisplayRef,
    openNote,
    onEdgeClick,
    setGraphFocusId,
    setGraphSelectedId,
  } = args;

  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const frameLoopRef = useRef<FrameLoop | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const baseSizesRef = useRef<Map<string, number>>(new Map());
  const basePositionsRef = useRef<Map<string, XY>>(new Map());
  // Latest notes, readable from the deferred build closure without making
  // ``notes`` a build-effect dependency.
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;
  // The lens reads note bodies from this map. It is refilled in place on
  // every notes change, so the lens tracks additions and lazily loaded bodies.
  const noteMapRef = useRef<Map<string, Note>>(new Map());
  // Survives rebuilds: the live node positions snapshotted before teardown,
  // so a rebuild re-seeds existing nodes (incl. dragged ones) instead of
  // reshuffling the whole graph from scratch.
  const positionCacheRef = useRef<Map<string, XY>>(new Map());
  // Applies a structural change to the live instance; null until built.
  const syncRef = useRef<((notes: Note[]) => GraphSyncResult) | null>(null);
  // structuralKey of the graph currently on screen; null until built.
  const liveKeyRef = useRef<string | null>(null);
  const orbitTargetsRef = useRef<Map<string, XY>>(new Map());
  const activeTweenRef = useRef<TweenHandle | null>(null);
  const breathingRemoveRef = useRef<(() => void) | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const justDraggedRef = useRef<boolean>(false);
  const stopDragSimRef = useRef<(() => void) | null>(null);

  const [sigmaReady, setSigmaReady] = useState(0);
  const [structureVersion, setStructureVersion] = useState(0);
  const [rebuildEpoch, setRebuildEpoch] = useState(0);
  const [building, setBuilding] = useState(false);
  const hasNotes = notes.length > 0;

  // Memoized on ``notes`` so unrelated context re-renders don't re-sort every
  // node id and edge in the vault.
  const structKey = useMemo(() => structuralKey(notes), [notes]);

  // Full build: once notes exist, and again only when an in-place sync
  // reports it cannot patch the change (bumping rebuildEpoch). Adding or
  // removing notes and links goes through the structure effect below.
  useEffect(() => {
    if (!hostRef.current || notesRef.current.length === 0) return;

    let cancelled = false;
    const buildStartedAt = performance.now();
    setBuilding(true);

    const buildRaf = requestAnimationFrame(() => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      const notes = notesRef.current;
      const heavyNow = notes.length > PERF_BUDGET_NODES;

      const { graph, baseSizes } = buildGraph(notes);
      const visibility = applyGraphVisibility(graph, {
        typeFilters: tuningRef.current.filters,
        selectedId: tuningRef.current.selected,
        isolateNeighbors: tuningRef.current.isolateNeighbors,
      });
      const visibleNodeCount = visibility.visibleCount;
      tuningRef.current.visibilityRestricted = visibility.restricted;
      baseSizesRef.current = baseSizes;
      graphRef.current = graph;
      // Seed from the cached layout so existing nodes keep their positions
      // (and any dragged placement) across a rebuild; only genuinely new
      // nodes are placed beside their neighbors and settled locally.
      basePositionsRef.current = applyConstellationLayout(
        graph,
        positionCacheRef.current,
      );

      // Static size baseline at the current scale; breathing (when active)
      // overwrites it each frame.
      graph.forEachNode((id) => {
        graph.setNodeAttribute(
          id,
          "size",
          (baseSizes.get(id) ?? 4) * tuningRef.current.sizeScale,
        );
      });

      tuningRef.current.degree = computeVisibleDegreeMap(graph);
      const edgeExtremities = computeEdgeExtremities(graph);
      const nodeZ = collectNodeZ(graph);

      const sigma = createSigma(graph, host);
      sigmaRef.current = sigma;
      sigma.setSetting("labelSize", graphDisplayRef.current.labelSize);
      sigma.setSetting(
        "renderLabels",
        visibleNodeCount <= GRAPH_LABEL_BUDGET_NODES,
      );
      tuningRef.current.cameraRatio = sigma.getCamera().ratio;
      tuningRef.current.labelTier = ratioToTier(tuningRef.current.cameraRatio);

      const debugHook = import.meta.env.DEV
        ? installGraphDebugHook({
            host: window,
            sigma,
            graph,
            buildStartedAt,
            isDragging: () => isDraggingRef.current,
          })
        : null;

      sigma.setSetting(
        "nodeReducer",
        makeNodeReducer(graph, tuningRef.current),
      );
      sigma.setSetting(
        "edgeReducer",
        makeEdgeReducer(graph, tuningRef.current, edgeExtremities, nodeZ),
      );

      const detachEvents = wireSigmaEvents({
        sigma,
        graph,
        host,
        tuning: tuningRef.current,
        isDragging: isDraggingRef,
        justDragged: justDraggedRef,
        openNote,
        onEdgeClick,
        setGraphFocusId,
        setGraphSelectedId,
      });

      const frameLoop = createFrameLoop(() =>
        sigma.refresh({ skipIndexation: true }),
      );
      frameLoopRef.current = frameLoop;

      const detachDrag = attachDrag({
        sigma,
        graph,
        frameLoop,
        getSnapTarget: (id) =>
          tuningRef.current.graphMode === "orbit"
            ? orbitTargetsRef.current.get(id)
            : basePositionsRef.current.get(id),
        // Dragging is exploratory: every layout springs back to its saved
        // geometry when released instead of permanently rearranging the vault.
        getReleaseMode: () => "elastic",
        clearHover: () => {
          tuningRef.current.hovered = null;
        },
        cancelTween: () => activeTweenRef.current?.cancel(),
        stopSimRef: stopDragSimRef,
        isDragging: isDraggingRef,
        justDragged: justDraggedRef,
        onSimulationStateChange: (active) => {
          // Keep decorative ticks paused through elastic settling. Resuming
          // breathing at mouse-up would otherwise compete with the spring
          // renderer by emitting hundreds of size updates per frame.
          tuningRef.current.dragging = active;
        },
      });

      // Overlay: travelers + lens, only below the perf budget.
      const overlay = overlayRef.current;
      if (overlay) {
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      }
      const travelers =
        !heavyNow && overlay
          ? createTravelers({
              overlay,
              graph,
              sigma,
              tuning: tuningRef.current,
            })
          : null;
      fillNoteMap(noteMapRef.current, notes);
      const lens =
        !heavyNow && overlay
          ? createLens({
              overlay,
              graph,
              sigma,
              host,
              noteMap: noteMapRef.current,
              tuning: tuningRef.current,
              openNote,
            })
          : null;
      const removeTravelers = travelers ? frameLoop.add(travelers.tick) : null;
      const removeLens = lens ? frameLoop.add(lens.tick) : null;

      const ro = new ResizeObserver(() => {
        sigma.resize();
        sigma.refresh();
      });
      ro.observe(host);

      liveKeyRef.current = structuralKey(notes);
      syncRef.current = (next) =>
        syncGraphStructure(
          {
            graph,
            sigma,
            tuning: tuningRef.current,
            baseSizesRef,
            basePositionsRef,
            edgeExtremities,
            nodeZ,
            travelers,
            heavy: heavyNow,
            haltMotion: () => {
              stopDragSimRef.current?.();
              activeTweenRef.current?.cancel();
              activeTweenRef.current = null;
            },
          },
          next,
        );

      const resetTimer = window.setTimeout(() => {
        sigma
          .getCamera()
          .animatedReset({ duration: 600, easing: easeInOutCubic });
      }, 200);

      teardownRef.current = () => {
        syncRef.current = null;
        liveKeyRef.current = null;
        // Complete/cancel any active elastic motion before caching positions.
        // Otherwise a rebuild during settle could seed the next graph from a
        // transient halfway point instead of the saved layout geometry.
        detachDrag();
        // Snapshot positions so the next rebuild can re-seed
        // existing nodes (preserving layout + any dragged placement). In
        // orbit mode the live attrs hold scene-ring geometry — seed from the
        // constellation base instead, so a rebuild (whose fresh-build skip
        // bypasses relayout) never paints rings into constellation mode.
        const snapshot = new Map<string, XY>();
        if (tuningRef.current.graphMode === "orbit") {
          for (const [id, p] of basePositionsRef.current) {
            snapshot.set(id, { x: p.x, y: p.y });
          }
        } else {
          graph.forEachNode((id, attrs) => {
            snapshot.set(id, {
              x: attrs["x"] as number,
              y: attrs["y"] as number,
            });
          });
        }
        positionCacheRef.current = snapshot;

        window.clearTimeout(resetTimer);
        ro.disconnect();
        detachEvents();
        breathingRemoveRef.current?.();
        breathingRemoveRef.current = null;
        activeTweenRef.current?.cancel();
        activeTweenRef.current = null;
        removeTravelers?.();
        removeLens?.();
        frameLoop.stop();
        travelers?.destroy();
        lens?.destroy();
        if (overlayRef.current) {
          while (overlayRef.current.firstChild) {
            overlayRef.current.removeChild(overlayRef.current.firstChild);
          }
        }
        debugHook?.uninstall();
        sigma.kill();
        sigmaRef.current = null;
        graphRef.current = null;
        frameLoopRef.current = null;
      };

      debugHook?.markReady();
      setBuilding(false);
      setSigmaReady((v) => v + 1);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(buildRaf);
      teardownRef.current?.();
      teardownRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNotes, rebuildEpoch]);

  // Structure sync: a node or link was added or removed. Diff it onto the
  // live graph (no sigma.kill(), no ForceAtlas2 on the main thread, camera
  // untouched). Before the deferred build has run there is nothing to patch
  // — the build reads the latest notes itself.
  useEffect(() => {
    const sync = syncRef.current;
    if (!sync || liveKeyRef.current === structKey) return;
    const result = sync(notesRef.current);
    if (result === "rebuild") {
      setRebuildEpoch((n) => n + 1);
      return;
    }
    liveKeyRef.current = structKey;
    if (result === "applied") setStructureVersion((n) => n + 1);
  }, [structKey]);

  useEffect(() => {
    fillNoteMap(noteMapRef.current, notes);
  }, [notes]);

  // Content sync: when a note's title or type changes, patch the affected
  // node attributes in place and refresh. Keyed on contentKey so it only fires
  // on real changes; nodes added by the structure effect above already carry
  // fresh content. Memoized on ``notes`` for the same reason as structKey.
  const contKey = useMemo(() => contentKey(notes), [notes]);
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    const { changed, typeChanged } = patchGraphContent(graph, notesRef.current);
    if (typeChanged) {
      // A type edit can move the node into or out of the active filter. Keep
      // materialized visibility and visible-subgraph label degrees coherent
      // without rebuilding the graph.
      const visibility = applyGraphVisibility(graph, {
        typeFilters: tuningRef.current.filters,
        selectedId: tuningRef.current.selected,
        isolateNeighbors: tuningRef.current.isolateNeighbors,
      });
      tuningRef.current.visibilityRestricted = visibility.restricted;
      tuningRef.current.degree = computeVisibleDegreeMap(graph);
      sigma.refresh();
    } else if (changed) {
      sigma.refresh({ skipIndexation: true });
    }
    // sigmaReady gates the first run until the instance exists; contKey drives
    // subsequent content-only updates.
  }, [contKey, sigmaReady, tuningRef]);

  return {
    sigmaRef,
    graphRef,
    frameLoopRef,
    baseSizesRef,
    basePositionsRef,
    orbitTargetsRef,
    activeTweenRef,
    breathingRemoveRef,
    stopDragSimRef,
    sigmaReady,
    structureVersion,
    building,
  };
}

function fillNoteMap(map: Map<string, Note>, notes: Note[]): void {
  map.clear();
  for (const n of notes) map.set(n.id, n);
}

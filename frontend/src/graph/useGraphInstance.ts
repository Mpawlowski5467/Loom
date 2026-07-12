import { useEffect, useRef, useState } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { GraphDisplay } from "../context/app-ctx";
import type { Note, NoteId } from "../data/types";
import { buildGraph, createSigma, readNodePalette } from "./sigma-setup";
import { readCssVar } from "../theme/readCssVar";
import { collectNodeZ, depthColorFor } from "./depth";
import { applyConstellationLayout, easeInOutCubic, type XY } from "./layouts";
import { structuralKey, contentKey } from "./graphKeys";
import { attachDrag } from "./dragHandlers";
import { createFrameLoop, type FrameLoop } from "./frameLoop";
import {
  computeEdgeExtremities,
  makeEdgeReducer,
  makeNodeReducer,
  ratioToTier,
} from "./reducers";
import { createTravelers } from "./travelers";
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
  sigmaReady: number;
  building: boolean;
}

/**
 * Owns the imperative Sigma instance: builds the graph + renderer, wires the
 * reducers, node events, drag, the shared frame loop, and the travelers/lens
 * overlay, then tears it all down on cleanup. The heavy build (ForceAtlas2) is
 * deferred one frame so the loading shimmer can paint first. Returns the live
 * handles the rest of GraphView's hooks/effects read.
 */
export function useGraphInstance(args: {
  notes: Note[];
  hostRef: Ref<HTMLDivElement | null>;
  overlayRef: Ref<SVGSVGElement | null>;
  tuningRef: Ref<GraphTuning>;
  graphDisplayRef: Ref<GraphDisplay>;
  openNote: (id: NoteId) => void;
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
  // ``notes`` a build-effect dependency (the structural key gates rebuilds).
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;
  // Survives rebuilds: the live node positions snapshotted before teardown,
  // so a structural rebuild re-seeds existing nodes (incl. dragged ones)
  // instead of reshuffling the whole graph from scratch.
  const positionCacheRef = useRef<Map<string, XY>>(new Map());
  const orbitTargetsRef = useRef<Map<string, XY>>(new Map());
  const activeTweenRef = useRef<TweenHandle | null>(null);
  const breathingRemoveRef = useRef<(() => void) | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const justDraggedRef = useRef<boolean>(false);
  const stopDragSimRef = useRef<(() => void) | null>(null);

  const [sigmaReady, setSigmaReady] = useState(0);
  const [building, setBuilding] = useState(false);

  // Rebuild only when the graph STRUCTURE changes (nodes/edges added or
  // removed) — not on every body/title/tag edit. structuralKey is a stable
  // string, so an edit that leaves structure intact yields an equal dep and
  // React skips this effect; the separate content-sync effect below patches
  // title/type changes in place. This avoids a sigma.kill() + 220-iteration
  // ForceAtlas2 on the main thread (and the camera reset + lost pan/zoom) on
  // every save.
  const structKey = structuralKey(notes);

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
      // (and any dragged placement) across a structural rebuild; only genuinely
      // new nodes get a fresh spiral slot + a short settling pass.
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

      // Camera ratio drives the label tier — refresh only when the tier flips,
      // not on every zoom frame.
      const onCameraUpdate = (): void => {
        const r = sigma.getCamera().ratio;
        const prevRatio = tuningRef.current.cameraRatio;
        tuningRef.current.cameraRatio = r;
        const tier = ratioToTier(r);
        const showRatio = tuningRef.current.labelShowRatio;
        const crossedShowRatio = prevRatio <= showRatio !== r <= showRatio;
        if (tier !== tuningRef.current.labelTier || crossedShowRatio) {
          tuningRef.current.labelTier = tier;
          sigma.refresh({ skipIndexation: true });
        }
      };
      sigma.getCamera().on("updated", onCameraUpdate);

      sigma.on("enterNode", ({ node }) => {
        if (isDraggingRef.current) return;
        tuningRef.current.hovered = node;
        sigma.refresh({ skipIndexation: true });
      });
      sigma.on("leaveNode", () => {
        if (isDraggingRef.current) return;
        tuningRef.current.hovered = null;
        sigma.refresh({ skipIndexation: true });
      });
      sigma.on("clickNode", ({ node }) => {
        if (isDraggingRef.current || justDraggedRef.current) return;
        host.focus({ preventScroll: true });
        setGraphSelectedId(node);
        // Orbit selection preserves the existing focus-first scene behavior;
        // selection remains separate so clearing the card does not reshuffle.
        if (tuningRef.current.graphMode === "orbit") setGraphFocusId(node);
      });
      sigma.on("clickStage", () => {
        if (isDraggingRef.current || justDraggedRef.current) return;
        host.focus({ preventScroll: true });
        setGraphSelectedId(null);
      });
      sigma.on("doubleClickNode", ({ node, event }) => {
        event.preventSigmaDefault?.();
        openNote(node);
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
      const lens =
        !heavyNow && overlay
          ? createLens({
              overlay,
              graph,
              sigma,
              host,
              noteMap: new Map(notes.map((n) => [n.id, n])),
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

      const resetTimer = window.setTimeout(() => {
        sigma
          .getCamera()
          .animatedReset({ duration: 600, easing: easeInOutCubic });
      }, 200);

      teardownRef.current = () => {
        // Complete/cancel any active elastic motion before caching positions.
        // Otherwise a rebuild during settle could seed the next graph from a
        // transient halfway point instead of the saved layout geometry.
        detachDrag();
        // Snapshot positions so the next structural rebuild can re-seed
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
        sigma.getCamera().off("updated", onCameraUpdate);
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
  }, [structKey]);

  // Content sync: when a note's title or type changes but the structure does
  // not, patch the affected node attributes in place and refresh — far cheaper
  // than a full rebuild. Keyed on contentKey so it only fires on real changes.
  // Skipped on a structural change because the build effect above (which shares
  // the same render) already rebuilds with fresh content.
  const contKey = contentKey(notes);
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    const palette = readNodePalette();
    const bg = readCssVar("--bg-base", "#f5f1e8");
    let changed = false;
    let typeChanged = false;
    for (const n of notesRef.current) {
      if (!graph.hasNode(n.id)) continue;
      if (graph.getNodeAttribute(n.id, "label") !== n.title) {
        graph.setNodeAttribute(n.id, "label", n.title);
        changed = true;
      }
      if (graph.getNodeAttribute(n.id, "noteType") !== n.type) {
        graph.setNodeAttribute(n.id, "noteType", n.type);
        graph.setNodeAttribute(n.id, "color", palette[n.type]);
        const z =
          (graph.getNodeAttribute(n.id, "z") as number | undefined) ?? 0;
        graph.setNodeAttribute(
          n.id,
          "depthColor",
          depthColorFor(palette[n.type], bg, z),
        );
        changed = true;
        typeChanged = true;
      }
    }
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
    building,
  };
}

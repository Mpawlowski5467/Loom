import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useApp } from "@/context/app-ctx";
import type { Note } from "@/data/types";
import type { CommunityResult } from "@/graph/communities";
import {
  exportGraphJson,
  exportGraphPng,
  exportGraphSvg,
} from "@/graph/export";
import {
  computeVisibleGraphBBox,
  graphVisibilityIsRestricted,
} from "@/graph/filtering";
import {
  findDirectionalNode,
  type GraphArrowKey,
} from "@/graph/keyboardNavigation";
import { easeInOutCubic } from "@/graph/layouts";
import { filterKey, type GraphNodeFilter } from "@/graph/nodeFilter";
import { spacingToCameraRatio } from "@/graph/reducers";
import { readEdgePalette } from "@/graph/sigma-setup";
import type { GraphTuning } from "@/graph/tuning";
import { useGraphDisplaySync } from "@/graph/useGraphDisplaySync";
import { PERF_BUDGET_NODES, useGraphInstance } from "@/graph/useGraphInstance";
import { useGraphScene } from "@/graph/useGraphScene";
import { useThemeColors } from "@/theme/useThemeColors";
import { makeNodePaint, paintKey } from "./graphPaint";
import type { ExportFormat } from "./GraphToolbar";
import { useBreathing, useFlyTo } from "./graphEffects";
import { useSelectionRing } from "./useSelectionRing";
import { visibleViewportPoints } from "./viewportPoints";

interface GraphCanvasArgs {
  notes: Note[];
  filter: GraphNodeFilter;
  communities: CommunityResult;
  communitiesOn: boolean;
  isolate: boolean;
  setIsolate: (update: (on: boolean) => boolean) => void;
  clearSelection: () => void;
}

/**
 * Wire the Sigma engine to the Graph view: build, display sync, scenes,
 * breathing, fly-to, the selection ring, and the camera/keyboard actions.
 */
export function useGraphCanvas(a: GraphCanvasArgs) {
  const { clearSelection, setIsolate } = a;
  const app = useApp();
  const { graphDisplay, graphSelectedId: selectedId } = app;
  const { setGraphSelectedId, setGraphFocusId, openNote, pushToast } = app;
  const colors = useThemeColors();
  const layout = graphDisplay.layout;
  const graphMode = layout === "force" ? "constellation" : "orbit";
  const heavy = a.notes.length > PERF_BUDGET_NODES;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const spacingScaleRef = useRef(graphDisplay.spacingScale);
  const graphDisplayRef = useRef(graphDisplay);
  useEffect(() => {
    graphDisplayRef.current = graphDisplay;
  }, [graphDisplay]);

  const nodeColor = useMemo(
    () => makeNodePaint(colors, a.communities.slotOf, a.communitiesOn),
    [colors, a.communities.slotOf, a.communitiesOn],
  );
  // Seeded once; useGraphDisplaySync keeps it current afterwards.
  const [initialTuning] = useState<GraphTuning>(() => ({
    hovered: null,
    selected: selectedId,
    isolateNeighbors: a.isolate,
    visibilityRestricted: false,
    dragging: false,
    filter: a.filter,
    nodeColor,
    communityOf: a.communities.slotOf,
    palette: readEdgePalette(),
    graphMode,
    sizeScale: graphDisplay.nodeSizeScale,
    travelerPace: graphDisplay.travelerPace,
    labelsEnabled: graphDisplay.labelsEnabled,
    labelShowRatio: graphDisplay.labelShowRatio,
    labelThreshold: graphDisplay.labelThreshold,
    travelersEnabled: graphDisplay.travelersEnabled,
    edgeThickness: graphDisplay.edgeThickness,
    depthEnabled: graphDisplay.depthEnabled,
    cameraRatio: 1,
    labelTier: -1,
    lensLabelHideFor: null,
    degree: new Map(),
  }));
  const tuningRef = useRef(initialTuning);

  const inst = useGraphInstance({
    notes: a.notes,
    hostRef,
    overlayRef,
    tuningRef,
    graphDisplayRef,
    openNote,
    setGraphFocusId,
    setGraphSelectedId,
  });
  const { sigmaRef, graphRef, sigmaReady, stopDragSimRef, activeTweenRef } =
    inst;
  const { orbitTargetsRef } = inst;

  useGraphDisplaySync({
    sigmaRef,
    graphRef,
    baseSizesRef: inst.baseSizesRef,
    spacingScaleRef,
    tuningRef,
    graphDisplay,
    graphMode,
    graphFilter: a.filter,
    communityOf: a.communities.slotOf,
    communityKey: a.communities.key,
    selectedNodeId: selectedId,
    isolateNeighbors: a.isolate,
    nodeColor,
    paintKey: paintKey(colors, a.communities.key, a.communitiesOn),
    sigmaReady,
    stopDragSimRef: inst.stopDragSimRef,
  });

  const stagedScene = useGraphScene({
    sigmaRef,
    graphRef,
    frameLoopRef: inst.frameLoopRef,
    activeTweenRef: inst.activeTweenRef,
    orbitTargetsRef: inst.orbitTargetsRef,
    basePositionsRef: inst.basePositionsRef,
    spacingScaleRef,
    stopDragSimRef: inst.stopDragSimRef,
    layout,
    graphFocusId: app.graphFocusId,
    selectedNodeId: selectedId,
    isolateNeighbors: a.isolate,
    notes: a.notes,
    sigmaReady,
    structureVersion: inst.structureVersion,
    layoutAutoCycle: graphDisplay.layoutAutoCycle,
    graphFilterKey: filterKey({ ...a.filter, createdBefore: null }),
  });

  useSelectionRing(sigmaRef, ringRef, selectedId, sigmaReady);
  useBreathing(inst, initialTuning, graphDisplay.breathingEnabled && !heavy);
  useFlyTo(inst, initialTuning, a.filter);

  const fit = useCallback(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    // Fit stable geometry: settle drag physics and finish any scene tween.
    stopDragSimRef.current?.();
    const tween = activeTweenRef.current;
    if (tween) {
      tween.cancel();
      activeTweenRef.current = null;
      if (graphMode === "orbit")
        for (const [id, target] of orbitTargetsRef.current)
          if (graph.hasNode(id)) graph.mergeNodeAttributes(id, target);
    }
    sigma.setCustomBBox(
      graphVisibilityIsRestricted(graph)
        ? computeVisibleGraphBBox(graph)
        : null,
    );
    sigma.refresh();
    sigma.getCamera().animate(
      {
        ratio: spacingToCameraRatio(spacingScaleRef.current),
        x: 0.5,
        y: 0.5,
      },
      { duration: 450, easing: easeInOutCubic },
    );
  }, [
    activeTweenRef,
    graphMode,
    graphRef,
    orbitTargetsRef,
    sigmaRef,
    stopDragSimRef,
  ]);

  const zoom = useCallback(
    (direction: 1 | -1) => {
      const camera = sigmaRef.current?.getCamera();
      if (!camera) return;
      if (direction > 0) void camera.animatedZoom({ duration: 220 });
      else void camera.animatedUnzoom({ duration: 220 });
    },
    [sigmaRef],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      const key = event.key;
      if (key.startsWith("Arrow") && sigma && graph) {
        const points = visibleViewportPoints(sigma, graph);
        const { width, height } = sigma.getDimensions();
        const next = findDirectionalNode(points, key as GraphArrowKey, {
          selectedOrigin: points.find((p) => p.id === selectedId) ?? null,
          viewportCenter: { x: width / 2, y: height / 2 },
        });
        if (!next) return;
        event.preventDefault();
        setGraphSelectedId(next.id);
        if (graphMode === "orbit") setGraphFocusId(next.id);
        return;
      }
      const action: Record<string, (() => void) | undefined> = {
        Enter: selectedId ? () => openNote(selectedId) : undefined,
        Escape: selectedId ? clearSelection : undefined,
        i: selectedId ? () => setIsolate((on) => !on) : undefined,
        f: fit,
        "+": () => zoom(1),
        "=": () => zoom(1),
        "-": () => zoom(-1),
      };
      const run = action[key.length === 1 ? key.toLowerCase() : key];
      if (!run) return;
      event.preventDefault();
      run();
    },
    [
      clearSelection,
      fit,
      graphMode,
      graphRef,
      openNote,
      selectedId,
      setGraphFocusId,
      setGraphSelectedId,
      setIsolate,
      sigmaRef,
      zoom,
    ],
  );

  const exportAs = useCallback(
    (format: ExportFormat) => {
      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      if (!sigma || !graph) return;
      try {
        if (format === "png") void exportGraphPng(sigma);
        else if (format === "svg")
          exportGraphSvg(sigma, graph, { depth: graphDisplay.depthEnabled });
        else exportGraphJson(graph);
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "sentinel",
          body: err instanceof Error ? err.message : "Export failed",
        });
      }
    },
    [graphDisplay.depthEnabled, graphRef, pushToast, sigmaRef],
  );

  return {
    hostRef,
    overlayRef,
    ringRef,
    building: inst.building,
    sigmaReady,
    stagedScene,
    heavy,
    fit,
    zoom,
    onKeyDown,
    exportAs,
  };
}

import { useEffect, useRef } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { GraphDisplay } from "../context/app-ctx";
import { applyPaletteToGraph } from "./sigma-setup";
import { easeInOutCubic } from "./layouts";
import { spacingToCameraRatio } from "./reducers";
import {
  GRAPH_LABEL_BUDGET_NODES,
  type GraphMode,
  type GraphTuning,
} from "./tuning";
import {
  applyGraphVisibility,
  computeVisibleGraphBBox,
  computeVisibleDegreeMap,
  isGraphNodeVisible,
} from "./filtering";
import type { NodePaint } from "./graphModel";
import {
  filterIsNarrowed,
  filterKey,
  type GraphNodeFilter,
} from "./nodeFilter";

interface Ref<T> {
  current: T;
}

/**
 * Mirror AppContext's ``graphDisplay`` (and theme / mode / filters) into the
 * live ``tuning`` object the render path reads, refreshing Sigma only for the
 * knobs that change a reducer's output. Initial values are seeded at graph
 * build time, so these effects only need to handle subsequent changes.
 */
export function useGraphDisplaySync(args: {
  sigmaRef: Ref<Sigma | null>;
  graphRef: Ref<Graph | null>;
  baseSizesRef: Ref<Map<string, number>>;
  spacingScaleRef: Ref<number>;
  tuningRef: Ref<GraphTuning>;
  graphDisplay: GraphDisplay;
  graphMode: GraphMode;
  graphFilter: GraphNodeFilter;
  /** Note id → community slot; mirrored onto node attributes. */
  communityOf: ReadonlyMap<string, number | null>;
  /** Changes when community membership changes. */
  communityKey: string;
  selectedNodeId?: string | null;
  isolateNeighbors?: boolean;
  /** Node fill colors (community or neutral, from the theme). */
  nodeColor: NodePaint;
  /** Changes whenever any node or edge color could have (theme, accent,
   *  palette, communities on/off, membership). */
  paintKey: string;
  sigmaReady: number;
  stopDragSimRef: Ref<(() => void) | null>;
}): void {
  const {
    sigmaRef,
    graphRef,
    baseSizesRef,
    spacingScaleRef,
    tuningRef,
    graphDisplay,
    graphMode,
    graphFilter,
    communityOf,
    communityKey,
    selectedNodeId = null,
    isolateNeighbors = false,
    nodeColor,
    paintKey,
    sigmaReady,
    stopDragSimRef,
  } = args;

  // Node size scale — reapply to the graph immediately so the slider is
  // responsive whether breathing is on, off, or paused by the perf budget.
  useEffect(() => {
    tuningRef.current.sizeScale = graphDisplay.nodeSizeScale;
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    graph.forEachNode((id) => {
      graph.setNodeAttribute(
        id,
        "size",
        (baseSizesRef.current.get(id) ?? 4) * tuningRef.current.sizeScale,
      );
    });
    sigma.refresh({ skipIndexation: true });
  }, [graphDisplay.nodeSizeScale, tuningRef, graphRef, sigmaRef, baseSizesRef]);

  useEffect(() => {
    tuningRef.current.travelerPace = graphDisplay.travelerPace;
  }, [graphDisplay.travelerPace, tuningRef]);

  useEffect(() => {
    tuningRef.current.travelersEnabled = graphDisplay.travelersEnabled;
  }, [graphDisplay.travelersEnabled, tuningRef]);

  useEffect(() => {
    tuningRef.current.labelsEnabled = graphDisplay.labelsEnabled;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelsEnabled, tuningRef, sigmaRef]);

  useEffect(() => {
    tuningRef.current.labelShowRatio = graphDisplay.labelShowRatio;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelShowRatio, tuningRef, sigmaRef]);

  useEffect(() => {
    tuningRef.current.labelThreshold = graphDisplay.labelThreshold;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelThreshold, tuningRef, sigmaRef]);

  useEffect(() => {
    tuningRef.current.edgeThickness = graphDisplay.edgeThickness;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.edgeThickness, tuningRef, sigmaRef]);

  // Depth toggles re-index (no skipIndexation): it changes rendered node
  // sizes, which feed the label grid and hit-testing.
  useEffect(() => {
    tuningRef.current.depthEnabled = graphDisplay.depthEnabled;
    sigmaRef.current?.refresh();
  }, [graphDisplay.depthEnabled, tuningRef, sigmaRef]);

  useEffect(() => {
    sigmaRef.current?.setSetting("labelSize", graphDisplay.labelSize);
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphDisplay.labelSize, sigmaRef]);

  // Spacing → camera zoom. Sigma auto-fits the bbox, so scaling positions has
  // no visual effect; a camera ratio gives the expected tighter/looser feel.
  useEffect(() => {
    spacingScaleRef.current = graphDisplay.spacingScale;
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.getCamera().animate(
      {
        ratio: spacingToCameraRatio(graphDisplay.spacingScale),
        x: 0.5,
        y: 0.5,
      },
      { duration: 300, easing: easeInOutCubic },
    );
  }, [graphDisplay.spacingScale, spacingScaleRef, sigmaRef]);

  useEffect(() => {
    tuningRef.current.graphMode = graphMode;
  }, [graphMode, tuningRef]);

  // Persistent selection is a render concern even when it does not narrow
  // visibility: selected size/label and incident-edge emphasis must repaint.
  useEffect(() => {
    tuningRef.current.selected = selectedNodeId;
    tuningRef.current.isolateNeighbors = isolateNeighbors;
    if (!isolateNeighbors) sigmaRef.current?.refresh();
  }, [selectedNodeId, isolateNeighbors, sigmaReady, tuningRef, sigmaRef]);

  const isolationSelectedId = isolateNeighbors ? selectedNodeId : null;
  const key = filterKey(graphFilter);
  // The timeline changes visibility continuously while dragging; only the
  // other criteria refit the camera.
  const fitKey = filterKey({ ...graphFilter, createdBefore: null });
  const lastFitKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Visibility is shared state, not merely a paint effect: physics, orbit
    // traversal, exports, hit-testing, and reducers must agree on which nodes
    // exist in the current view. Cancel an active/settling drag before changing
    // that participant set.
    stopDragSimRef.current?.();
    tuningRef.current.filter = graphFilter;
    tuningRef.current.communityOf = communityOf;
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    graph.updateEachNodeAttributes(
      (id, attributes) => ({
        ...attributes,
        community: communityOf.get(id) ?? null,
      }),
      { attributes: ["community"] },
    );
    const visibility = applyGraphVisibility(graph, {
      filter: graphFilter,
      selectedId: isolationSelectedId,
      isolateNeighbors,
    });
    const visibleNodeCount = visibility.visibleCount;
    tuningRef.current.visibilityRestricted = visibility.restricted;
    tuningRef.current.degree = computeVisibleDegreeMap(graph);
    const hovered = tuningRef.current.hovered;
    if (hovered && !isGraphNodeVisible(graph, hovered)) {
      tuningRef.current.hovered = null;
    }
    // Fit normalization to the visible subset while a filter is active. This
    // keeps a small result set from remaining compressed inside the full
    // vault's old bounds. Clearing filters restores Sigma's natural bbox.
    const refit = lastFitKeyRef.current !== `${fitKey}|${isolationSelectedId}`;
    lastFitKeyRef.current = `${fitKey}|${isolationSelectedId}`;
    if (refit)
      sigma.setCustomBBox(
        filterIsNarrowed({ ...graphFilter, createdBefore: null }) ||
          visibility.isolationActive
          ? computeVisibleGraphBBox(graph)
          : null,
      );
    sigma.setSetting(
      "renderLabels",
      visibleNodeCount <= GRAPH_LABEL_BUDGET_NODES,
    );
    // A visibility/bounds change affects programs, labels, hit-testing, and
    // edges. It is user-triggered and infrequent, so correctness wins over a
    // partial repaint here.
    sigma.refresh();
    if (refit && graphMode === "constellation") {
      sigma.getCamera().animate(
        {
          ratio: spacingToCameraRatio(spacingScaleRef.current),
          x: 0.5,
          y: 0.5,
        },
        { duration: 450, easing: easeInOutCubic },
      );
    }
    // graphFilter/communityOf are captured by `key`/`communityKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    key,
    fitKey,
    communityKey,
    isolationSelectedId,
    isolateNeighbors,
    sigmaReady,
    graphMode,
    tuningRef,
    sigmaRef,
    graphRef,
    spacingScaleRef,
    stopDragSimRef,
  ]);

  // Theme swap: Sigma re-reads node colors on refresh, so update attributes +
  // settings in place rather than recreating the renderer. The tuning object
  // is passed in so its palette swaps before the reducers re-run inside.
  useEffect(() => {
    tuningRef.current.nodeColor = nodeColor;
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    applyPaletteToGraph(sigma, graph, tuningRef.current);
    // nodeColor is captured by paintKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintKey, sigmaReady, tuningRef, sigmaRef, graphRef]);
}

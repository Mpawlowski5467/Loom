import type Graph from "graphology";
import type { Settings } from "sigma/settings";
import type { GraphTuning } from "./tuning";

/** Spacing slider → camera ratio. Sigma auto-fits node bbox, so the perceived
 * "tighter / spread out" change is a camera zoom, not a position rescale. */
export function spacingToCameraRatio(scale: number): number {
  return 1 / scale;
}

/**
 * Zoom-tiered label visibility: the minimum degree a node must have to show
 * its label at the given camera ratio. ``labelKnob`` is the user slider
 * (1..20): lower = more labels, higher = fewer. ``Infinity`` means "no labels".
 */
export function labelDegreeFloor(ratio: number, labelKnob: number): number {
  if (labelKnob >= 19) return Infinity;
  if (labelKnob <= 1) return 0;
  const base = (labelKnob - 1) * (6 / 18);
  let zoomMul: number;
  if (ratio < 0.4) zoomMul = 0.4;
  else if (ratio < 1.0) zoomMul = 1.0;
  else zoomMul = 1.0 + (ratio - 1.0) * 1.2;
  return Math.round(base * zoomMul);
}

export function ratioToTier(ratio: number): number {
  if (ratio < 0.4) return 0;
  if (ratio < 1.0) return 1;
  if (ratio < 2.0) return 2;
  return 3;
}

export type EdgeExtremities = Map<string, readonly [string, string]>;

/** Precompute each edge's [source, target] once at build time so the hover
 * edge-reducer is an O(1) map lookup instead of ``graph.extremities()`` per
 * edge per refresh. */
export function computeEdgeExtremities(graph: Graph): EdgeExtremities {
  const map: EdgeExtremities = new Map();
  graph.forEachEdge((edge, _attr, source, target) => {
    map.set(edge, [source, target]);
  });
  return map;
}

type NodeReducer = NonNullable<Settings["nodeReducer"]>;
type EdgeReducer = NonNullable<Settings["edgeReducer"]>;

export function makeNodeReducer(graph: Graph, tuning: GraphTuning): NodeReducer {
  return (id, data) => {
    const hovered = tuning.hovered;
    const filters = tuning.filters;
    if (filters.size > 0 && !filters.has(data["noteType"] as string)) {
      return { ...data, hidden: true };
    }

    // Hover overrides every other label rule: the hovered node always shows
    // its label; everything else hides its label until hover ends.
    if (hovered) {
      if (id === hovered) {
        const lensHide = id === tuning.lensLabelHideFor;
        return lensHide ? { ...data, label: "" } : data;
      }
      const isNeighbor =
        graph.hasEdge(hovered, id) || graph.hasEdge(id, hovered);
      if (isNeighbor) return { ...data, label: "" };
      return { ...data, color: tuning.palette.nodeDimmed, label: "" };
    }

    if (!tuning.labelsEnabled) return { ...data, label: "" };
    if (tuning.cameraRatio > tuning.labelShowRatio) {
      return { ...data, label: "" };
    }

    const floor = labelDegreeFloor(tuning.cameraRatio, tuning.labelThreshold);
    const degree = tuning.degree.get(id) ?? 0;
    const lensHide = id === tuning.lensLabelHideFor;
    if (lensHide || degree < floor) return { ...data, label: "" };
    return data;
  };
}

export function makeEdgeReducer(
  graph: Graph,
  tuning: GraphTuning,
  extremities: EdgeExtremities,
): EdgeReducer {
  return (id, data) => {
    const hovered = tuning.hovered;
    const k = tuning.edgeThickness;
    const baseSize = (data.size ?? 1) * k;
    if (!hovered) return { ...data, size: baseSize };
    const ext = extremities.get(id) ?? graph.extremities(id);
    if (ext[0] === hovered || ext[1] === hovered) {
      return { ...data, color: tuning.palette.edgeHover, size: 1.4 * k };
    }
    return { ...data, color: tuning.palette.edgeFaint, size: baseSize };
  };
}

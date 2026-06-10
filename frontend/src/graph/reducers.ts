import type Graph from "graphology";
import type { Settings } from "sigma/settings";
import { DEPTH_EDGE_FADE, depthSizeFactor, makeEdgeFader } from "./depth";
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

    // Faux-3D depth: deep nodes render smaller and washed toward the paper.
    // (Positions are untouched — Sigma re-reads x/y from graph attributes and
    // ignores reducer overrides.) The hovered node is exempt — hover pops it
    // onto the focus plane at full size and ink.
    const out = { ...data };
    const z = (data["z"] as number | undefined) ?? 0;
    if (tuning.depthEnabled && z > 0 && id !== hovered) {
      out.size = (data.size ?? 4) * depthSizeFactor(z);
      const depthColor = data["depthColor"] as string | undefined;
      if (depthColor) out.color = depthColor;
    }

    // Hover overrides every other label rule: the hovered node always shows
    // its label; everything else hides its label until hover ends.
    if (hovered) {
      if (id === hovered) {
        const lensHide = id === tuning.lensLabelHideFor;
        if (lensHide) out.label = "";
        return out;
      }
      const isNeighbor =
        graph.hasEdge(hovered, id) || graph.hasEdge(id, hovered);
      out.label = "";
      if (!isNeighbor) out.color = tuning.palette.nodeDimmed;
      return out;
    }

    if (!tuning.labelsEnabled) {
      out.label = "";
      return out;
    }
    if (tuning.cameraRatio > tuning.labelShowRatio) {
      out.label = "";
      return out;
    }

    const floor = labelDegreeFloor(tuning.cameraRatio, tuning.labelThreshold);
    const degree = tuning.degree.get(id) ?? 0;
    const lensHide = id === tuning.lensLabelHideFor;
    if (lensHide || degree < floor) out.label = "";
    return out;
  };
}

export function makeEdgeReducer(
  graph: Graph,
  tuning: GraphTuning,
  extremities: EdgeExtremities,
  /** Per-node depth (z) for the depth fade; omit to disable. */
  nodeZ?: Map<string, number>,
): EdgeReducer {
  const fade = makeEdgeFader();
  return (id, data) => {
    const hovered = tuning.hovered;
    const k = tuning.edgeThickness;
    const baseSize = (data.size ?? 1) * k;
    const ext = extremities.get(id) ?? graph.extremities(id);
    if (hovered) {
      if (ext[0] === hovered || ext[1] === hovered) {
        return { ...data, color: tuning.palette.edgeHover, size: 1.4 * k };
      }
      return { ...data, color: tuning.palette.edgeFaint, size: baseSize };
    }
    // Depth fade: edges recede with the average depth of their endpoints.
    if (tuning.depthEnabled && nodeZ) {
      const z = ((nodeZ.get(ext[0]) ?? 0) + (nodeZ.get(ext[1]) ?? 0)) / 2;
      if (z > 0) {
        const color = fade(
          (data.color as string | undefined) ?? tuning.palette.edge,
          1 - DEPTH_EDGE_FADE * z,
        );
        return { ...data, color, size: baseSize };
      }
    }
    return { ...data, size: baseSize };
  };
}

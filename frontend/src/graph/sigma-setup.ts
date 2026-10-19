import type Graph from "graphology";
import Sigma from "sigma";
import type { Settings } from "sigma/settings";
import { readCssVar } from "../theme/readCssVar";
import type { NodeType } from "../data/types";
import { depthColorFor, fadeAlpha } from "./depth";
import { glColor } from "./glColor";
import { typePaint, type NodePaint } from "./graphModel";

export interface EdgePalette {
  edge: string;
  edgeHover: string;
  edgeFaint: string;
  label: string;
  nodeDimmed: string;
}

/** Edge, label and dimmed-node colors: translucent ink from the theme. */
export function readEdgePalette(): EdgePalette {
  const ink = readCssVar("--foreground", "#1a1815");
  return {
    edge: fadeAlpha(ink, 0.18),
    // Edges of the hovered/selected node are drawn in the brand color.
    edgeHover: readCssVar("--brand", "#60a5fa"),
    edgeFaint: fadeAlpha(ink, 0.06),
    label: readCssVar("--secondary-foreground", "#5c5851"),
    nodeDimmed: fadeAlpha(ink, 0.12),
  };
}

export function defaultSettings(): Partial<Settings> {
  const palette = readEdgePalette();
  return {
    allowInvalidContainer: true,
    labelColor: { color: palette.label },
    labelSize: 11,
    labelFont: readCssVar("--font-ui", "Geist Variable, system-ui, sans-serif"),
    labelWeight: "500",
    defaultEdgeColor: glColor(palette.edge),
    renderEdgeLabels: false,
    // Label visibility is owned by GraphView's nodeReducer (zoom-tiered by
    // degree). Disable Sigma's density-based hide/show: it competes with the
    // breathing animation and causes labels to flicker on and off every frame.
    labelDensity: 10_000,
    labelGridCellSize: 1,
    labelRenderedSizeThreshold: 0,
    // Depth cue: draw nearer (lower-z) nodes over deeper ones.
    zIndex: true,
    enableEdgeEvents: false,
    minCameraRatio: 0.2,
    maxCameraRatio: 8,
    // Wheel-zoom feel: small per-tick ratio (1.25) + long, overlapping
    // animations (400ms). Sigma throttles incoming wheel events to
    // zoomDuration/5 = 80ms which lines up with typical trackpad cadence,
    // so fast scrolls read as one continuous slide instead of discrete jumps.
    zoomingRatio: 1.25,
    zoomDuration: 500,
  };
}

export function createSigma(graph: Graph, container: HTMLElement): Sigma {
  return new Sigma(graph, container, defaultSettings());
}

/**
 * Apply the current theme's palette to an existing graph + sigma instance.
 *
 * Updates every node's ``color`` attribute, swaps ``labelColor`` and
 * ``defaultEdgeColor`` settings, then calls ``refresh()``. Sigma 3 re-reads
 * node colors on every paint, so this is enough — there's no need to
 * dispose and recreate the renderer.
 */
export function applyPaletteToGraph(
  sigma: Sigma,
  graph: Graph,
  /** When given, ``tuning.palette`` is swapped BEFORE any reducer re-run —
   * ``setSetting``/``refresh`` below re-run the reducers synchronously, and
   * the edge depth fade reads the live palette. */
  tuning?: { palette: EdgePalette; nodeColor?: NodePaint },
): EdgePalette {
  const paint = tuning?.nodeColor ?? typePaint();
  const edgePalette = readEdgePalette();
  if (tuning) tuning.palette = edgePalette;
  const bg = readCssVar("--background", "#f5f1e8");
  graph.forEachNode((id) => {
    const noteType = graph.getNodeAttribute(id, "noteType") as
      | NodeType
      | undefined;
    if (!noteType) return;
    const color = paint(id, noteType);
    graph.setNodeAttribute(id, "color", color);
    const z = (graph.getNodeAttribute(id, "z") as number | undefined) ?? 0;
    graph.setNodeAttribute(id, "depthColor", depthColorFor(color, bg, z));
  });
  sigma.setSetting("labelColor", { color: edgePalette.label });
  sigma.setSetting("defaultEdgeColor", glColor(edgePalette.edge));
  sigma.refresh({ skipIndexation: true });
  return edgePalette;
}

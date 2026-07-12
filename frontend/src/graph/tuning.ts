import type { EdgePalette } from "./sigma-setup";
import type { NodeType } from "../data/types";

/**
 * Internal render-path mode derived from the selected layout: "force" renders
 * as the constellation (FA2) layout; every other layout is an orbit scene.
 */
export type GraphMode = "constellation" | "orbit";

/** Above this visible-node count, label canvas work is suspended. */
export const GRAPH_LABEL_BUDGET_NODES = 500;

/**
 * Live, mutable graph-rendering state shared between the React view and the
 * imperative render path (Sigma reducers + the per-frame overlay ticks).
 *
 * One object instead of ~15 separate refs: the view mutates fields from
 * display-setting effects, and the reducers/ticks read them every frame. All
 * consumers capture the same object identity once at graph-build time, so
 * field writes are observed live without re-wiring closures.
 */
export interface GraphTuning {
  hovered: string | null;
  /** Persistent node selection; unlike hover it survives pointer leave. */
  selected: string | null;
  /** Whether visibility is narrowed to selected + direct neighbors. */
  isolateNeighbors: boolean;
  /** Type filters and/or neighborhood isolation currently restrict the graph. */
  visibilityRestricted: boolean;
  /** True from pointer-down through spring settling. Decorative work pauses. */
  dragging: boolean;
  filters: Set<NodeType>;
  palette: EdgePalette;
  graphMode: GraphMode;

  // Display-setting knobs (synced from AppContext.graphDisplay).
  sizeScale: number;
  travelerPace: number;
  labelsEnabled: boolean;
  labelShowRatio: number;
  labelThreshold: number;
  travelersEnabled: boolean;
  edgeThickness: number;
  depthEnabled: boolean;

  // Derived/animated state owned by the render path.
  cameraRatio: number;
  labelTier: number;
  lensLabelHideFor: string | null;
  degree: Map<string, number>;
}

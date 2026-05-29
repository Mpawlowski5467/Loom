import type { GraphMode } from "../data/types";
import type { EdgePalette } from "./sigma-setup";

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
  filters: Set<string>;
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

  // Derived/animated state owned by the render path.
  cameraRatio: number;
  labelTier: number;
  lensLabelHideFor: string | null;
  degree: Map<string, number>;
}

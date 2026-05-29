import { useEffect } from "react";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { ThemeName } from "../theme/themes";
import type { GraphDisplay } from "../context/app-ctx";
import type { GraphMode } from "../data/types";
import { applyPaletteToGraph } from "./sigma-setup";
import { easeInOutCubic } from "./layouts";
import { spacingToCameraRatio } from "./reducers";
import type { GraphTuning } from "./tuning";

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
  graphFilters: Set<string>;
  theme: ThemeName;
}): void {
  const {
    sigmaRef,
    graphRef,
    baseSizesRef,
    spacingScaleRef,
    tuningRef,
    graphDisplay,
    graphMode,
    graphFilters,
    theme,
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
      { ratio: spacingToCameraRatio(graphDisplay.spacingScale), x: 0.5, y: 0.5 },
      { duration: 300, easing: easeInOutCubic },
    );
  }, [graphDisplay.spacingScale, spacingScaleRef, sigmaRef]);

  useEffect(() => {
    tuningRef.current.graphMode = graphMode;
  }, [graphMode, tuningRef]);

  useEffect(() => {
    tuningRef.current.filters = graphFilters;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graphFilters, tuningRef, sigmaRef]);

  // Theme swap: Sigma re-reads node colors on refresh, so update attributes +
  // settings in place rather than recreating the renderer.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    tuningRef.current.palette = applyPaletteToGraph(sigma, graph);
  }, [theme, tuningRef, sigmaRef, graphRef]);
}

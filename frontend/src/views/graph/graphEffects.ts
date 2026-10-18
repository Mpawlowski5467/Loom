import { useEffect } from "react";
import { useApp } from "@/context/app-ctx";
import { createBreathingTick } from "@/graph/breathing";
import { easeInOutCubic } from "@/graph/layouts";
import {
  filterKey,
  nodePassesFilter,
  type GraphNodeFilter,
} from "@/graph/nodeFilter";
import type { GraphTuning } from "@/graph/tuning";
import type { useGraphInstance } from "@/graph/useGraphInstance";

type Instance = ReturnType<typeof useGraphInstance>;

/** Register the breathing tick, or restore base sizes when it's off. */
export function useBreathing(
  inst: Instance,
  tuning: GraphTuning,
  enabled: boolean,
): void {
  const { graphRef, frameLoopRef, sigmaRef, baseSizesRef, breathingRemoveRef } =
    inst;
  useEffect(() => {
    const graph = graphRef.current;
    const frameLoop = frameLoopRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !frameLoop || !sigma) return;
    breathingRemoveRef.current?.();
    breathingRemoveRef.current = null;
    if (enabled) {
      breathingRemoveRef.current = frameLoop.add(
        createBreathingTick(graph, baseSizesRef.current, tuning),
      );
    } else {
      graph.forEachNode((id) =>
        graph.setNodeAttribute(
          id,
          "size",
          (baseSizesRef.current.get(id) ?? 4) * tuning.sizeScale,
        ),
      );
      sigma.refresh({ skipIndexation: true });
    }
    return () => {
      breathingRemoveRef.current?.();
      breathingRemoveRef.current = null;
    };
    // Refs are stable; sigmaReady re-runs this after a (re)build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, inst.sigmaReady]);
}

/**
 * Search → fly to a node: widen the filter if it hides the target, then
 * select it, center the camera on it and spotlight it briefly.
 */
export function useFlyTo(
  inst: Instance,
  tuning: GraphTuning,
  filter: GraphNodeFilter,
): void {
  const { graphFlyTo, setGraphFilter, setGraphSelectedId, setGraphFocusId } =
    useApp();
  const { sigmaRef, graphRef, sigmaReady } = inst;
  const key = filterKey(filter);
  useEffect(() => {
    if (!graphFlyTo) return;
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(graphFlyTo.id)) return;
    const attrs = graph.getNodeAttributes(graphFlyTo.id);
    if (!nodePassesFilter(attrs, filter)) {
      setGraphFilter({
        folder: null,
        community: null,
        createdBefore: null,
        showSuperseded: filter.showSuperseded || attrs["superseded"] === true,
      });
      return;
    }
    const disp = sigma.getNodeDisplayData(graphFlyTo.id);
    if (!disp) return;
    setGraphSelectedId(graphFlyTo.id);
    if (tuning.graphMode === "orbit") setGraphFocusId(graphFlyTo.id);
    sigma
      .getCamera()
      .animate(
        { x: disp.x, y: disp.y, ratio: 0.45 },
        { duration: 650, easing: easeInOutCubic },
      );
    tuning.hovered = graphFlyTo.id;
    sigma.refresh({ skipIndexation: true });
    const clear = window.setTimeout(() => {
      if (tuning.hovered !== graphFlyTo.id) return;
      tuning.hovered = null;
      sigmaRef.current?.refresh({ skipIndexation: true });
    }, 1500);
    return () => window.clearTimeout(clear);
    // Refs are stable; sigmaReady re-runs this after a (re)build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphFlyTo, sigmaReady, key]);
}

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { GraphToolbar } from "../components/graph/GraphToolbar";
import type { ExportFormat } from "../components/graph/GraphToolbar";
import {
  exportGraphJson,
  exportGraphPng,
  exportGraphSvg,
} from "../graph/export";
import { createBreathingTick } from "../graph/breathing";
import { easeInOutCubic, ORBIT_SCENE_LABELS } from "../graph/layouts";
import { readEdgePalette } from "../graph/sigma-setup";
import { useGraphInstance, PERF_BUDGET_NODES } from "../graph/useGraphInstance";
import { useGraphScene } from "../graph/useGraphScene";
import { useGraphDisplaySync } from "../graph/useGraphDisplaySync";
import type { GraphTuning } from "../graph/tuning";

export function GraphView(): ReactNode {
  const {
    notes,
    notesLoaded,
    openNote,
    graphFocusId,
    setGraphFocusId,
    graphFlyTo,
    graphFilters,
    toggleGraphFilter,
    clearGraphFilters,
    graphDisplay,
    theme,
    pushToast,
  } = useApp();

  // Internal render-path mode derived from the selected layout: "force" is the
  // constellation branch; every other layout renders as an orbit scene.
  const layout = graphDisplay.layout;
  const graphMode = layout === "force" ? "constellation" : "orbit";

  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const spacingScaleRef = useRef<number>(graphDisplay.spacingScale);

  // Latest display settings for build-time seeding (the build effect only
  // depends on ``notes``, so it reads this rather than a stale closure).
  const graphDisplayRef = useRef(graphDisplay);
  graphDisplayRef.current = graphDisplay;

  const heavy = notes.length > PERF_BUDGET_NODES;

  // One mutable object for all render-path state, instead of ~15 refs. The
  // reducers and overlay ticks capture it once and read live fields; the
  // display-sync hook mutates it through the ref.
  const tuningRef = useRef<GraphTuning>({
    hovered: null,
    filters: graphFilters,
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
  });
  const tuning = tuningRef.current;

  const stats = useMemo(
    () => ({
      nodes: notes.length,
      edges: notes.reduce((a, n) => a + n.links.length, 0),
    }),
    [notes],
  );

  const {
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
  } = useGraphInstance({
    notes,
    hostRef,
    overlayRef,
    tuningRef,
    graphDisplayRef,
    openNote,
    setGraphFocusId,
  });

  // Sync display settings → tuning + Sigma.
  useGraphDisplaySync({
    sigmaRef,
    graphRef,
    baseSizesRef,
    spacingScaleRef,
    tuningRef,
    graphDisplay,
    graphMode,
    graphFilters,
    theme,
  });

  // Layout staging (returns the scene on stage for the caption).
  const stagedScene = useGraphScene({
    sigmaRef,
    graphRef,
    frameLoopRef,
    activeTweenRef,
    orbitTargetsRef,
    basePositionsRef,
    spacingScaleRef,
    stopDragSimRef,
    layout,
    graphFocusId,
    notes,
    sigmaReady,
    layoutAutoCycle: graphDisplay.layoutAutoCycle,
  });

  // Breathing lifecycle — register/unregister the tick, honoring the user
  // toggle and the perf budget.
  useEffect(() => {
    const graph = graphRef.current;
    const frameLoop = frameLoopRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !frameLoop || !sigma) return;

    breathingRemoveRef.current?.();
    breathingRemoveRef.current = null;

    if (graphDisplay.breathingEnabled && !heavy) {
      breathingRemoveRef.current = frameLoop.add(
        createBreathingTick(graph, baseSizesRef.current, tuning),
      );
    } else {
      graph.forEachNode((id) => {
        graph.setNodeAttribute(
          id,
          "size",
          (baseSizesRef.current.get(id) ?? 4) * tuning.sizeScale,
        );
      });
      sigma.refresh({ skipIndexation: true });
    }
    return () => {
      breathingRemoveRef.current?.();
      breathingRemoveRef.current = null;
    };
    // Refs are stable; sigmaReady re-runs this after a (re)build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphDisplay.breathingEnabled, sigmaReady, heavy, tuning]);

  // Search → fly to node: center + zoom the camera on the target and spotlight
  // it briefly by reusing the hover highlight.
  useEffect(() => {
    if (!graphFlyTo) return;
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(graphFlyTo.id)) return;
    const disp = sigma.getNodeDisplayData(graphFlyTo.id);
    if (!disp) return;
    sigma.getCamera().animate(
      { x: disp.x, y: disp.y, ratio: 0.45 },
      { duration: 650, easing: easeInOutCubic },
    );
    tuning.hovered = graphFlyTo.id;
    sigma.refresh({ skipIndexation: true });
    const clear = window.setTimeout(() => {
      if (tuning.hovered === graphFlyTo.id) {
        tuning.hovered = null;
        sigmaRef.current?.refresh({ skipIndexation: true });
      }
    }, 1500);
    return () => window.clearTimeout(clear);
    // Refs are stable; sigmaReady re-runs this after a (re)build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphFlyTo, sigmaReady, tuning]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      if (!sigma || !graph) return;
      try {
        if (format === "png") void exportGraphPng(sigma);
        else if (format === "svg")
          exportGraphSvg(sigma, graph, { depth: tuning.depthEnabled });
        else exportGraphJson(graph);
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "sentinel",
          body: err instanceof Error ? err.message : "Export failed",
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushToast],
  );

  // Only show "empty" once the initial load has settled — otherwise a
  // populated vault flashes "your graph is empty" for the whole cold fetch.
  const empty = notesLoaded && notes.length === 0;
  const loadingNotes = !notesLoaded && notes.length === 0;

  return (
    <div className="graph-view">
      <GraphToolbar
        graphFilters={graphFilters}
        toggleGraphFilter={toggleGraphFilter}
        clearGraphFilters={clearGraphFilters}
        onExport={handleExport}
      />
      <div className="graph-canvas">
        <div ref={hostRef} className="sigma-container" />
        <svg
          ref={overlayRef}
          className="graph-travelers"
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 4,
          }}
        />
        {loadingNotes && (
          <div className="graph-loading" role="status">
            <span className="graph-loading-orbit" aria-hidden />
            loading your vault…
          </div>
        )}
        {empty && (
          <div className="graph-empty">
            Your graph is empty — capture a note to start weaving.
          </div>
        )}
        {!empty && !loadingNotes && building && (
          <div className="graph-loading" role="status">
            <span className="graph-loading-orbit" aria-hidden />
            arranging {stats.nodes} nodes…
          </div>
        )}
        {!empty && layout !== "force" && (
          <div className="graph-scene-caption" key={stagedScene}>
            <span className="graph-scene-kicker">Layout</span>
            <span className="graph-scene-name">
              {ORBIT_SCENE_LABELS[stagedScene]}
            </span>
          </div>
        )}
        {!empty && (
          <div className="graph-stats">
            {stats.nodes} nodes · {stats.edges} edges
            {heavy && (
              <span className="graph-perf-note">
                {" "}
                · animations paused (large graph)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

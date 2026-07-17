import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { GraphToolbar } from "../components/graph/GraphToolbar";
import { GraphSelectionCard } from "../components/graph/GraphSelectionCard";
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
import {
  computeVisibleGraphBBox,
  computeVisibleGraphStats,
  computeVisibleNeighborIds,
  graphVisibilityIsRestricted,
  isNodeTypeVisible,
} from "../graph/filtering";
import {
  findDirectionalNode,
  type GraphArrowKey,
  type ViewportNodePoint,
} from "../graph/keyboardNavigation";
import { spacingToCameraRatio } from "../graph/reducers";
import type { NodeType } from "../data/types";

export function GraphView(): ReactNode {
  const {
    notes,
    notesLoaded,
    notesError,
    openNote,
    graphFocusId,
    setGraphFocusId,
    graphSelectedId,
    setGraphSelectedId,
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
  const [isolateNeighbors, setIsolateNeighbors] = useState(false);

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
    selected: graphSelectedId,
    isolateNeighbors,
    visibilityRestricted: graphFilters.size > 0,
    dragging: false,
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

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === graphSelectedId) ?? null,
    [notes, graphSelectedId],
  );
  const selectedNeighborIds = useMemo(
    () => computeVisibleNeighborIds(notes, graphFilters, graphSelectedId),
    [notes, graphFilters, graphSelectedId],
  );
  const stats = useMemo(
    () =>
      computeVisibleGraphStats(notes, graphFilters, {
        selectedId: graphSelectedId,
        isolateNeighbors,
      }),
    [notes, graphFilters, graphSelectedId, isolateNeighbors],
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
    setGraphSelectedId,
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
    selectedNodeId: graphSelectedId,
    isolateNeighbors,
    theme,
    sigmaReady,
    stopDragSimRef,
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
    selectedNodeId: graphSelectedId,
    isolateNeighbors,
    notes,
    sigmaReady,
    layoutAutoCycle: graphDisplay.layoutAutoCycle,
    graphFilters,
  });

  const clearSelection = useCallback(() => {
    setIsolateNeighbors(false);
    setGraphSelectedId(null);
  }, [setGraphSelectedId]);

  // Selection can outlive a note or a type-filter change because it lives in
  // AppContext across tab switches. Clear stale/hidden selections as soon as
  // the graph view sees them again.
  useEffect(() => {
    if (!graphSelectedId) {
      if (isolateNeighbors) setIsolateNeighbors(false);
      return;
    }
    if (!selectedNote || !isNodeTypeVisible(selectedNote.type, graphFilters)) {
      clearSelection();
    }
  }, [
    graphSelectedId,
    selectedNote,
    graphFilters,
    isolateNeighbors,
    clearSelection,
  ]);

  const handleFitView = useCallback(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    // Fit against stable geometry. Elastic drag settling and orbit staging both
    // move graph attributes after input ends; snapshotting their midpoint would
    // leave the eventual nodes clipped against a stale custom bounding box.
    stopDragSimRef.current?.();
    if (activeTweenRef.current) {
      activeTweenRef.current.cancel();
      activeTweenRef.current = null;
      if (graphMode === "orbit") {
        for (const [id, target] of orbitTargetsRef.current) {
          if (!graph.hasNode(id)) continue;
          graph.setNodeAttribute(id, "x", target.x);
          graph.setNodeAttribute(id, "y", target.y);
        }
      }
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

  const handleCenterSelected = useCallback(() => {
    if (!graphSelectedId) return;
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(graphSelectedId)) return;
    const center = sigma.getNodeDisplayData(graphSelectedId);
    if (!center) return;
    sigma
      .getCamera()
      .animate(
        { x: center.x, y: center.y, ratio: 0.45 },
        { duration: 500, easing: easeInOutCubic },
      );
  }, [graphSelectedId, graphRef, sigmaRef]);

  const handleClearSelection = useCallback(() => {
    // Move focus before the card unmounts so keyboard users stay in the graph
    // instead of falling back to the document body.
    hostRef.current?.focus({ preventScroll: true });
    clearSelection();
  }, [clearSelection]);

  const handleGraphKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const sigma = sigmaRef.current;
      const graph = graphRef.current;

      if (event.key.startsWith("Arrow") && sigma && graph) {
        const points: ViewportNodePoint[] = [];
        graph.forEachNode((id, attributes) => {
          if (attributes["hidden"]) return;
          const point = sigma.graphToViewport({
            x: Number(attributes["x"]),
            y: Number(attributes["y"]),
          });
          if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
            points.push({ id, x: point.x, y: point.y });
          }
        });
        const selectedOrigin = graphSelectedId
          ? (points.find((point) => point.id === graphSelectedId) ?? null)
          : null;
        const dimensions = sigma.getDimensions();
        const next = findDirectionalNode(points, event.key as GraphArrowKey, {
          selectedOrigin,
          viewportCenter: {
            x: dimensions.width / 2,
            y: dimensions.height / 2,
          },
        });
        if (next) {
          event.preventDefault();
          setGraphSelectedId(next.id);
          if (graphMode === "orbit") setGraphFocusId(next.id);
        }
        return;
      }

      if (event.key === "Enter" && selectedNote) {
        event.preventDefault();
        openNote(selectedNote.id);
      } else if (event.key === "Escape" && graphSelectedId) {
        event.preventDefault();
        clearSelection();
      } else if (event.key.toLowerCase() === "i" && graphSelectedId) {
        event.preventDefault();
        setIsolateNeighbors((value) => !value);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        handleFitView();
      }
    },
    [
      clearSelection,
      graphMode,
      graphRef,
      graphSelectedId,
      handleFitView,
      openNote,
      selectedNote,
      setGraphFocusId,
      setGraphSelectedId,
      sigmaRef,
    ],
  );

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
    const targetType = graph.getNodeAttribute(
      graphFlyTo.id,
      "noteType",
    ) as NodeType;
    if (graphFilters.size > 0 && !graphFilters.has(targetType)) {
      toggleGraphFilter(targetType);
      return;
    }
    const disp = sigma.getNodeDisplayData(graphFlyTo.id);
    if (!disp) return;
    setGraphSelectedId(graphFlyTo.id);
    if (graphMode === "orbit") setGraphFocusId(graphFlyTo.id);
    sigma
      .getCamera()
      .animate(
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
  }, [
    graphFlyTo,
    sigmaReady,
    tuning,
    graphFilters,
    graphMode,
    toggleGraphFilter,
    setGraphFocusId,
    setGraphSelectedId,
  ]);

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
  // A failed fetch shows an error state instead, so a backend outage is never
  // mistaken for an empty vault.
  const loadFailed = notesLoaded && notesError !== null && notes.length === 0;
  const empty = notesLoaded && notesError === null && notes.length === 0;
  const filteredEmpty =
    notesLoaded &&
    notes.length > 0 &&
    graphFilters.size > 0 &&
    stats.nodes === 0;
  const loadingNotes = !notesLoaded && notes.length === 0;

  return (
    <div className="graph-view">
      <GraphToolbar
        graphFilters={graphFilters}
        toggleGraphFilter={toggleGraphFilter}
        clearGraphFilters={clearGraphFilters}
        notes={notes}
        onExport={handleExport}
        onFitView={handleFitView}
        fitDisabled={empty || loadFailed || loadingNotes || building}
      />
      <div className="graph-canvas">
        <div
          ref={hostRef}
          className="sigma-container"
          role="application"
          tabIndex={0}
          aria-label="Knowledge graph"
          aria-describedby="graph-keyboard-help"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape I F"
          onKeyDown={handleGraphKeyDown}
          onPointerDown={(event) =>
            event.currentTarget.focus({ preventScroll: true })
          }
        />
        <p id="graph-keyboard-help" className="graph-sr-only">
          Use arrow keys to select nearby nodes, Enter to open, I to show direct
          neighbors only, F to fit visible nodes, and Escape to clear selection.
        </p>
        <p className="graph-sr-only" aria-live="polite" aria-atomic="true">
          {selectedNote
            ? `Selected ${selectedNote.title}, ${selectedNeighborIds.size} ${
                selectedNeighborIds.size === 1 ? "connection" : "connections"
              }`
            : "No graph node selected"}
        </p>
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
        {selectedNote && (
          <GraphSelectionCard
            note={selectedNote}
            connectionCount={selectedNeighborIds.size}
            neighborsOnly={isolateNeighbors}
            onNeighborsOnlyChange={setIsolateNeighbors}
            onCenterNode={handleCenterSelected}
            onOpenNote={() => openNote(selectedNote.id)}
            onClearSelection={handleClearSelection}
          />
        )}
        {loadingNotes && (
          <div className="graph-loading" role="status">
            <span className="graph-loading-orbit" aria-hidden />
            loading your vault…
          </div>
        )}
        {loadFailed && (
          <div className="graph-empty graph-load-error" role="alert">
            <span className="graph-empty-title">
              Couldn’t load your vault
            </span>
            <span className="graph-empty-hint">
              {notesError}. Check the backend and reload.
            </span>
          </div>
        )}
        {empty && (
          <div className="graph-empty">
            Your graph is empty — capture a note to start weaving.
          </div>
        )}
        {filteredEmpty && (
          <div className="graph-empty graph-filter-empty" role="status">
            <span>No notes match these filters.</span>
            <button type="button" onClick={clearGraphFilters}>
              Clear filters
            </button>
          </div>
        )}
        {!empty && !loadFailed && !filteredEmpty && !loadingNotes && building && (
          <div className="graph-loading" role="status">
            <span className="graph-loading-orbit" aria-hidden />
            arranging {stats.nodes} nodes…
          </div>
        )}
        {!empty && !loadFailed && !filteredEmpty && layout !== "force" && (
          <div className="graph-scene-caption" key={stagedScene}>
            <span className="graph-scene-kicker">Layout</span>
            <span className="graph-scene-name">
              {ORBIT_SCENE_LABELS[stagedScene]}
            </span>
          </div>
        )}
        {!empty && !loadFailed && !filteredEmpty && (
          <div className="graph-stats">
            {stats.nodes === notes.length
              ? `${stats.nodes} ${stats.nodes === 1 ? "node" : "nodes"}`
              : `${stats.nodes} of ${notes.length} nodes`}{" "}
            · {stats.edges} {stats.edges === 1 ? "edge" : "edges"}
            {isolateNeighbors && selectedNote && (
              <span className="graph-perf-note"> · neighborhood focus</span>
            )}
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

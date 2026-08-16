import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { GraphFixtureSize } from "../data/graphFixtures";
import type { NoteId, NodeType, Tab } from "../data/types";
import { sanitizeGraphFilters } from "../graph/filtering";
import {
  GRAPH_DISPLAY_DEFAULTS,
  GRAPH_DISPLAY_RANGES,
  GRAPH_LAYOUTS,
} from "./app-ctx";
import type { GraphDisplay } from "./app-ctx";

const GRAPH_DISPLAY_KEY = "loom.graphDisplay";
const GRAPH_FILTERS_KEY = "loom.graphFilters";
const PERSIST_DEBOUNCE_MS = 300;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function loadGraphFilters(): Set<NodeType> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(GRAPH_FILTERS_KEY);
    if (!raw) return new Set();
    return sanitizeGraphFilters(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

/** Older builds persisted the auto-cycle flag as ``orbitAutoCycle``. */
type PersistedGraphDisplay = Partial<GraphDisplay> & {
  orbitAutoCycle?: unknown;
};

function loadGraphDisplay(): GraphDisplay {
  if (typeof window === "undefined") return GRAPH_DISPLAY_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(GRAPH_DISPLAY_KEY);
    if (!raw) return GRAPH_DISPLAY_DEFAULTS;
    const parsed = JSON.parse(raw) as PersistedGraphDisplay;
    return {
      nodeSizeScale: clamp(
        Number(parsed.nodeSizeScale ?? GRAPH_DISPLAY_DEFAULTS.nodeSizeScale),
        GRAPH_DISPLAY_RANGES.nodeSizeScale.min,
        GRAPH_DISPLAY_RANGES.nodeSizeScale.max,
      ),
      labelThreshold: clamp(
        Number(parsed.labelThreshold ?? GRAPH_DISPLAY_DEFAULTS.labelThreshold),
        GRAPH_DISPLAY_RANGES.labelThreshold.min,
        GRAPH_DISPLAY_RANGES.labelThreshold.max,
      ),
      spacingScale: clamp(
        Number(parsed.spacingScale ?? GRAPH_DISPLAY_DEFAULTS.spacingScale),
        GRAPH_DISPLAY_RANGES.spacingScale.min,
        GRAPH_DISPLAY_RANGES.spacingScale.max,
      ),
      travelerPace: clamp(
        Number(parsed.travelerPace ?? GRAPH_DISPLAY_DEFAULTS.travelerPace),
        GRAPH_DISPLAY_RANGES.travelerPace.min,
        GRAPH_DISPLAY_RANGES.travelerPace.max,
      ),
      labelsEnabled:
        typeof parsed.labelsEnabled === "boolean"
          ? parsed.labelsEnabled
          : GRAPH_DISPLAY_DEFAULTS.labelsEnabled,
      labelSize: clamp(
        Number(parsed.labelSize ?? GRAPH_DISPLAY_DEFAULTS.labelSize),
        GRAPH_DISPLAY_RANGES.labelSize.min,
        GRAPH_DISPLAY_RANGES.labelSize.max,
      ),
      labelShowRatio: clamp(
        Number(parsed.labelShowRatio ?? GRAPH_DISPLAY_DEFAULTS.labelShowRatio),
        GRAPH_DISPLAY_RANGES.labelShowRatio.min,
        GRAPH_DISPLAY_RANGES.labelShowRatio.max,
      ),
      edgeThickness: clamp(
        Number(parsed.edgeThickness ?? GRAPH_DISPLAY_DEFAULTS.edgeThickness),
        GRAPH_DISPLAY_RANGES.edgeThickness.min,
        GRAPH_DISPLAY_RANGES.edgeThickness.max,
      ),
      travelersEnabled:
        typeof parsed.travelersEnabled === "boolean"
          ? parsed.travelersEnabled
          : GRAPH_DISPLAY_DEFAULTS.travelersEnabled,
      breathingEnabled:
        typeof parsed.breathingEnabled === "boolean"
          ? parsed.breathingEnabled
          : GRAPH_DISPLAY_DEFAULTS.breathingEnabled,
      depthEnabled:
        typeof parsed.depthEnabled === "boolean"
          ? parsed.depthEnabled
          : GRAPH_DISPLAY_DEFAULTS.depthEnabled,
      layout: (GRAPH_LAYOUTS as readonly string[]).includes(
        parsed.layout as string,
      )
        ? (parsed.layout as GraphDisplay["layout"])
        : GRAPH_DISPLAY_DEFAULTS.layout,
      layoutAutoCycle:
        typeof parsed.layoutAutoCycle === "boolean"
          ? parsed.layoutAutoCycle
          : typeof parsed.orbitAutoCycle === "boolean"
            ? parsed.orbitAutoCycle
            : GRAPH_DISPLAY_DEFAULTS.layoutAutoCycle,
    };
  } catch {
    return GRAPH_DISPLAY_DEFAULTS;
  }
}

export interface GraphNavigationState {
  graphFocusId: NoteId | null;
  setGraphFocusId: Dispatch<SetStateAction<NoteId | null>>;
  graphSelectedId: NoteId | null;
  setGraphSelectedId: Dispatch<SetStateAction<NoteId | null>>;
  graphFlyTo: { id: NoteId; nonce: number } | null;
  flyToNode: (id: NoteId) => void;
  graphFilters: Set<NodeType>;
  toggleGraphFilter: (type: NodeType) => void;
  clearGraphFilters: () => void;
  graphDisplay: GraphDisplay;
  setGraphDisplay: (patch: Partial<GraphDisplay>) => void;
  resetGraphDisplay: () => void;
}

export function useGraphNavigation(
  graphFixture: GraphFixtureSize | null,
  setTab: Dispatch<SetStateAction<Tab>>,
): GraphNavigationState {
  const [graphFocusId, setGraphFocusId] = useState<NoteId | null>(null);
  const [graphSelectedId, setGraphSelectedId] = useState<NoteId | null>(null);
  const [graphFlyTo, setGraphFlyTo] = useState<{
    id: NoteId;
    nonce: number;
  } | null>(null);
  const flyToNode = useCallback(
    (id: NoteId) => {
      setTab("graph");
      setGraphFlyTo((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [setTab],
  );

  const [graphFilters, setGraphFilters] = useState<Set<NodeType>>(() =>
    graphFixture !== null ? new Set() : loadGraphFilters(),
  );
  const toggleGraphFilter = useCallback((type: NodeType) => {
    setGraphFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);
  const clearGraphFilters = useCallback(() => setGraphFilters(new Set()), []);
  useEffect(() => {
    if (graphFixture !== null || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          GRAPH_FILTERS_KEY,
          JSON.stringify([...graphFilters]),
        );
      } catch {
        // ignore quota / serialization failures
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [graphFilters, graphFixture]);

  const [graphDisplay, setGraphDisplayState] = useState<GraphDisplay>(() =>
    graphFixture !== null ? GRAPH_DISPLAY_DEFAULTS : loadGraphDisplay(),
  );
  const setGraphDisplay = useCallback((patch: Partial<GraphDisplay>) => {
    setGraphDisplayState((prev) => ({
      nodeSizeScale: clamp(
        patch.nodeSizeScale ?? prev.nodeSizeScale,
        GRAPH_DISPLAY_RANGES.nodeSizeScale.min,
        GRAPH_DISPLAY_RANGES.nodeSizeScale.max,
      ),
      labelThreshold: clamp(
        patch.labelThreshold ?? prev.labelThreshold,
        GRAPH_DISPLAY_RANGES.labelThreshold.min,
        GRAPH_DISPLAY_RANGES.labelThreshold.max,
      ),
      spacingScale: clamp(
        patch.spacingScale ?? prev.spacingScale,
        GRAPH_DISPLAY_RANGES.spacingScale.min,
        GRAPH_DISPLAY_RANGES.spacingScale.max,
      ),
      travelerPace: clamp(
        patch.travelerPace ?? prev.travelerPace,
        GRAPH_DISPLAY_RANGES.travelerPace.min,
        GRAPH_DISPLAY_RANGES.travelerPace.max,
      ),
      labelsEnabled: patch.labelsEnabled ?? prev.labelsEnabled,
      labelSize: clamp(
        patch.labelSize ?? prev.labelSize,
        GRAPH_DISPLAY_RANGES.labelSize.min,
        GRAPH_DISPLAY_RANGES.labelSize.max,
      ),
      labelShowRatio: clamp(
        patch.labelShowRatio ?? prev.labelShowRatio,
        GRAPH_DISPLAY_RANGES.labelShowRatio.min,
        GRAPH_DISPLAY_RANGES.labelShowRatio.max,
      ),
      edgeThickness: clamp(
        patch.edgeThickness ?? prev.edgeThickness,
        GRAPH_DISPLAY_RANGES.edgeThickness.min,
        GRAPH_DISPLAY_RANGES.edgeThickness.max,
      ),
      travelersEnabled: patch.travelersEnabled ?? prev.travelersEnabled,
      breathingEnabled: patch.breathingEnabled ?? prev.breathingEnabled,
      depthEnabled: patch.depthEnabled ?? prev.depthEnabled,
      layout:
        patch.layout !== undefined &&
        (GRAPH_LAYOUTS as readonly string[]).includes(patch.layout)
          ? patch.layout
          : prev.layout,
      layoutAutoCycle: patch.layoutAutoCycle ?? prev.layoutAutoCycle,
    }));
  }, []);
  const resetGraphDisplay = useCallback(
    () => setGraphDisplayState(GRAPH_DISPLAY_DEFAULTS),
    [],
  );
  useEffect(() => {
    if (graphFixture !== null || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          GRAPH_DISPLAY_KEY,
          JSON.stringify(graphDisplay),
        );
      } catch {
        // ignore quota / serialization failures
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [graphDisplay, graphFixture]);

  return {
    graphFocusId,
    setGraphFocusId,
    graphSelectedId,
    setGraphSelectedId,
    graphFlyTo,
    flyToNode,
    graphFilters,
    toggleGraphFilter,
    clearGraphFilters,
    graphDisplay,
    setGraphDisplay,
    resetGraphDisplay,
  };
}

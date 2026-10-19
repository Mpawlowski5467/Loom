import type Graph from "graphology";
import type { Note } from "../data/types";
import {
  filterIsNarrowed,
  nodePassesFilter,
  notePassesFilter,
  type GraphNodeFilter,
} from "./nodeFilter";

/** Read the materialized visibility used by physics, layouts, and exports. */
export function isGraphNodeVisible(graph: Graph, id: string): boolean {
  return graph.hasNode(id) && !graph.getNodeAttribute(id, "hidden");
}

export interface GraphVisibilityOptions {
  filter: GraphNodeFilter;
  selectedId?: string | null;
  isolateNeighbors?: boolean;
}

export interface GraphVisibilityResult {
  visibleCount: number;
  selectedVisible: boolean;
  isolationActive: boolean;
  restricted: boolean;
}

/**
 * Materialize the graph's complete visibility state in one pass. The node
 * filter (folder, community, superseded, timeline) is applied first; optional neighborhood isolation then retains the selected
 * visible node and its direct visible in/out neighbors. Keeping both reasons
 * on attributes prevents a later filter update from accidentally erasing the
 * isolation boundary (or vice versa).
 */
export function applyGraphVisibility(
  graph: Graph,
  options: GraphVisibilityOptions,
): GraphVisibilityResult {
  const { filter, selectedId = null, isolateNeighbors = false } = options;
  const selectedVisible = Boolean(
    selectedId &&
    graph.hasNode(selectedId) &&
    nodePassesFilter(graph.getNodeAttributes(selectedId), filter),
  );
  const isolationActive = Boolean(
    isolateNeighbors && selectedId && selectedVisible,
  );
  const neighborhood = new Set<string>();
  if (isolationActive && selectedId) {
    neighborhood.add(selectedId);
    graph.forEachNeighbor(selectedId, (neighbor, attributes) => {
      if (nodePassesFilter(attributes, filter)) {
        neighborhood.add(neighbor);
      }
    });
  }

  let visibleCount = 0;
  graph.updateEachNodeAttributes(
    (id, attributes) => {
      const hiddenByFilter = !nodePassesFilter(attributes, filter);
      const hiddenByIsolation = isolationActive && !neighborhood.has(id);
      const hidden = hiddenByFilter || hiddenByIsolation;
      if (!hidden) visibleCount += 1;
      return {
        ...attributes,
        hiddenByFilter,
        hiddenByIsolation,
        hidden,
      };
    },
    {
      attributes: ["hidden", "hiddenByFilter", "hiddenByIsolation"],
    },
  );

  return {
    visibleCount,
    selectedVisible,
    isolationActive,
    restricted:
      filterIsNarrowed(filter) || isolationActive || visibleCount < graph.order,
  };
}

/** True when any filter/isolation rule currently hides at least one node. */
export function graphVisibilityIsRestricted(graph: Graph): boolean {
  return graph.someNode((_id, attributes) => Boolean(attributes["hidden"]));
}

/** Degree inside the visible induced subgraph; hidden nodes receive degree 0. */
export function computeVisibleDegreeMap(graph: Graph): Map<string, number> {
  const degree = new Map<string, number>();
  graph.forEachNode((id) => degree.set(id, 0));
  graph.forEachEdge((_edge, _attributes, source, target) => {
    if (
      !isGraphNodeVisible(graph, source) ||
      !isGraphNodeVisible(graph, target)
    ) {
      return;
    }
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  });
  return degree;
}

export interface VisibleGraphStats {
  nodes: number;
  edges: number;
}

/** Direct incoming/outgoing neighbors that survive the active filter. */
export function computeVisibleNeighborIds(
  notes: readonly Note[],
  filter: GraphNodeFilter,
  selectedId: string | null,
  slotOf: ReadonlyMap<string, number | null> = new Map(),
): Set<string> {
  if (!selectedId) return new Set();
  const visibleIds = new Set(
    notes
      .filter((note) => notePassesFilter(note, filter, slotOf))
      .map((note) => note.id),
  );
  if (!visibleIds.has(selectedId)) return new Set();

  const neighbors = new Set<string>();
  for (const note of notes) {
    if (!visibleIds.has(note.id)) continue;
    if (note.id === selectedId) {
      for (const linkedId of note.links) {
        if (linkedId !== selectedId && visibleIds.has(linkedId)) {
          neighbors.add(linkedId);
        }
      }
    } else if (note.links.includes(selectedId)) {
      neighbors.add(note.id);
    }
  }
  return neighbors;
}

export interface GraphViewportBBox {
  x: [number, number];
  y: [number, number];
}

/**
 * Compute a padded Sigma custom bounding box from finite graph positions.
 * Empty inputs return null; degenerate one-node/line extents are expanded so
 * Sigma always receives a usable two-dimensional viewport.
 */
export function computePositionBBox(
  positions: Iterable<{ x: number; y: number }>,
): GraphViewportBBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const { x, y } of positions) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const fallbackPadding = Math.max(spanX, spanY) * 0.05 || 1;
  const padX = spanX > 0 ? spanX * 0.05 : fallbackPadding;
  const padY = spanY > 0 ? spanY * 0.05 : fallbackPadding;
  return {
    x: [minX - padX, maxX + padX],
    y: [minY - padY, maxY + padY],
  };
}

/** Bounding box of the currently materialized visible node subset. */
export function computeVisibleGraphBBox(
  graph: Graph,
): GraphViewportBBox | null {
  const positions: Array<{ x: number; y: number }> = [];
  graph.forEachNode((id, attrs) => {
    if (!isGraphNodeVisible(graph, id)) return;
    positions.push({ x: Number(attrs["x"]), y: Number(attrs["y"]) });
  });
  return computePositionBBox(positions);
}

/**
 * Count a filtered note collection using the same edge semantics as
 * `buildGraph`: unknown targets are ignored and reciprocal/duplicate links
 * collapse into one undirected visual edge.
 */
export function computeVisibleGraphStats(
  notes: readonly Note[],
  filter: GraphNodeFilter,
  scope?: { selectedId?: string | null; isolateNeighbors?: boolean },
  slotOf: ReadonlyMap<string, number | null> = new Map(),
): VisibleGraphStats {
  const filterVisibleIds = new Set(
    notes
      .filter((note) => notePassesFilter(note, filter, slotOf))
      .map((note) => note.id),
  );
  let visibleIds = filterVisibleIds;
  const selectedId = scope?.selectedId ?? null;
  if (
    scope?.isolateNeighbors &&
    selectedId &&
    filterVisibleIds.has(selectedId)
  ) {
    visibleIds = new Set([
      selectedId,
      ...computeVisibleNeighborIds(notes, filter, selectedId, slotOf),
    ]);
  }
  const seen = new Map<string, Set<string>>();
  let edges = 0;

  for (const note of notes) {
    if (!visibleIds.has(note.id)) continue;
    for (const linkedId of note.links) {
      if (!visibleIds.has(linkedId)) continue;
      const [a, b] =
        note.id <= linkedId ? [note.id, linkedId] : [linkedId, note.id];
      let targets = seen.get(a);
      if (!targets) {
        targets = new Set<string>();
        seen.set(a, targets);
      }
      if (targets.has(b)) continue;
      targets.add(b);
      edges++;
    }
  }

  return { nodes: visibleIds.size, edges };
}

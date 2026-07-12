import type Graph from "graphology";
import type { Note, NodeType } from "../data/types";

/** Canonical runtime list for every graph-visible note type. */
export const NODE_TYPES: readonly NodeType[] = [
  "project",
  "topic",
  "people",
  "daily",
  "capture",
  "custom",
] as const;

const NODE_TYPE_SET: ReadonlySet<string> = new Set(NODE_TYPES);

/**
 * Validate graph-filter data loaded from storage. Older versions used the
 * singular `person`; migrate it while discarding malformed and unknown values.
 */
export function sanitizeGraphFilters(value: unknown): Set<NodeType> {
  const filters = new Set<NodeType>();
  if (!Array.isArray(value)) return filters;

  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const normalized = raw.trim().toLowerCase();
    const migrated = normalized === "person" ? "people" : normalized;
    if (NODE_TYPE_SET.has(migrated)) filters.add(migrated as NodeType);
  }
  return filters;
}

/** Empty filters mean "all types"; otherwise the set is an inclusion list. */
export function isNodeTypeVisible(
  type: string,
  filters: ReadonlySet<string>,
): boolean {
  return filters.size === 0 || filters.has(type);
}

/** Read the materialized visibility used by physics, layouts, and exports. */
export function isGraphNodeVisible(graph: Graph, id: string): boolean {
  return graph.hasNode(id) && !graph.getNodeAttribute(id, "hidden");
}

export interface GraphVisibilityOptions {
  typeFilters: ReadonlySet<string>;
  selectedId?: string | null;
  isolateNeighbors?: boolean;
}

export interface GraphVisibilityResult {
  visibleCount: number;
  selectedVisible: boolean;
  isolationActive: boolean;
  restricted: boolean;
}

function nodePassesTypeFilters(
  attributes: Record<string, unknown>,
  filters: ReadonlySet<string>,
): boolean {
  return isNodeTypeVisible(String(attributes["noteType"] ?? "custom"), filters);
}

/**
 * Materialize the graph's complete visibility state in one pass. Type filters
 * are applied first; optional neighborhood isolation then retains the selected
 * visible node and its direct visible in/out neighbors. Keeping both reasons
 * on attributes prevents a later filter update from accidentally erasing the
 * isolation boundary (or vice versa).
 */
export function applyGraphVisibility(
  graph: Graph,
  options: GraphVisibilityOptions,
): GraphVisibilityResult {
  const { typeFilters, selectedId = null, isolateNeighbors = false } = options;
  const selectedVisible = Boolean(
    selectedId &&
    graph.hasNode(selectedId) &&
    nodePassesTypeFilters(graph.getNodeAttributes(selectedId), typeFilters),
  );
  const isolationActive = Boolean(
    isolateNeighbors && selectedId && selectedVisible,
  );
  const neighborhood = new Set<string>();
  if (isolationActive && selectedId) {
    neighborhood.add(selectedId);
    graph.forEachNeighbor(selectedId, (neighbor, attributes) => {
      if (nodePassesTypeFilters(attributes, typeFilters)) {
        neighborhood.add(neighbor);
      }
    });
  }

  let visibleCount = 0;
  graph.updateEachNodeAttributes(
    (id, attributes) => {
      const hiddenByType = !nodePassesTypeFilters(attributes, typeFilters);
      const hiddenByIsolation = isolationActive && !neighborhood.has(id);
      const hidden = hiddenByType || hiddenByIsolation;
      if (!hidden) visibleCount += 1;
      return {
        ...attributes,
        hiddenByType,
        hiddenByIsolation,
        hidden,
      };
    },
    {
      attributes: ["hidden", "hiddenByType", "hiddenByIsolation", "noteType"],
    },
  );

  return {
    visibleCount,
    selectedVisible,
    isolationActive,
    restricted: typeFilters.size > 0 || isolationActive,
  };
}

/**
 * Materialize type filters on Graphology nodes. Reducer-only visibility is not
 * enough: simulations and non-Sigma renderers read graph attributes directly.
 * Returns the number of visible nodes.
 */
export function applyGraphFilters(
  graph: Graph,
  filters: ReadonlySet<string>,
): number {
  return applyGraphVisibility(graph, { typeFilters: filters }).visibleCount;
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

/** Direct incoming/outgoing neighbors that survive the active type filters. */
export function computeVisibleNeighborIds(
  notes: readonly Note[],
  filters: ReadonlySet<string>,
  selectedId: string | null,
): Set<string> {
  if (!selectedId) return new Set();
  const visibleIds = new Set(
    notes
      .filter((note) => isNodeTypeVisible(note.type, filters))
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
  filters: ReadonlySet<string>,
  scope?: { selectedId?: string | null; isolateNeighbors?: boolean },
): VisibleGraphStats {
  const typeVisibleIds = new Set(
    notes
      .filter((note) => isNodeTypeVisible(note.type, filters))
      .map((note) => note.id),
  );
  let visibleIds = typeVisibleIds;
  const selectedId = scope?.selectedId ?? null;
  if (scope?.isolateNeighbors && selectedId && typeVisibleIds.has(selectedId)) {
    visibleIds = new Set([
      selectedId,
      ...computeVisibleNeighborIds(notes, filters, selectedId),
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

import type Graph from "graphology";
import type Sigma from "sigma";
import type { Note } from "../data/types";
import { readCssVar } from "../theme/readCssVar";
import { depthColorFor, zForNode } from "./depth";
import {
  adjacencyFor,
  desiredStructure,
  diffGraphStructure,
  isEmptyDiff,
  type DesiredStructure,
  type StructureDiff,
} from "./graphDiff";
import { applyGraphVisibility, computeVisibleDegreeMap } from "./filtering";
import { isLargeBatch } from "./batchSettle";
import { relaxNewNodes } from "./localRelax";
import type { XY } from "./orbitScenes";
import { measureLayoutFrame, placeNewNodes } from "./placement";
import type { EdgeExtremities } from "./reducers";
import {
  baseSizeFor,
  connectionCounts,
  filterAttributesFor,
  nodeAttributesFor,
  nodeVisualsFor,
  type NodeContext,
} from "./graphModel";
import { GRAPH_LABEL_BUDGET_NODES, type GraphTuning } from "./tuning";

interface Ref<T> {
  current: T;
}

/** The live renderer state a structural sync patches in place. */
export interface GraphSyncTarget {
  graph: Graph;
  sigma: Sigma;
  tuning: GraphTuning;
  baseSizesRef: Ref<Map<string, number>>;
  /** Constellation homes: the force layout and every drag spring-back. */
  basePositionsRef: Ref<Map<string, XY>>;
  /** The edge reducer's caches, kept in step with the graph. */
  edgeExtremities: EdgeExtremities;
  nodeZ: Map<string, number>;
  travelers: { sync: () => void } | null;
  /** Whether the overlays were skipped for size at build time. */
  heavy: boolean;
  /** Halt drag sims and layout tweens before the node set changes. */
  haltMotion: () => void;
  /** Settle a large batch of new nodes off the main thread (force layout
   * only); every other node stays pinned. See batchSettle.ts. */
  settleBatch?: (ids: string[]) => void;
  random?: () => number;
}

/** "rebuild": the change cannot be patched (nothing survives, or the overlay
 * perf budget flipped) and the caller should rebuild from scratch. */
export type GraphSyncResult = "unchanged" | "applied" | "rebuild";

/**
 * Bring the live graph in line with ``notes`` without recreating Sigma. The
 * camera, reducers, frame loop and overlays survive; new nodes are placed
 * beside their neighbors and settled locally while every other node stays put.
 * A large batch in the force layout then gets a bounded worker settle.
 */
export function syncGraphStructure(
  target: GraphSyncTarget,
  notes: Note[],
): GraphSyncResult {
  const desired = desiredStructure(notes);
  const diff = diffGraphStructure(target.graph, desired);
  if (isEmptyDiff(diff)) return "unchanged";
  const survivors = target.graph.order - diff.removedNodes.length;
  const heavy = notes.length > GRAPH_LABEL_BUDGET_NODES;
  if (survivors === 0 || heavy !== target.heavy) return "rebuild";

  target.haltMotion();
  const frame = target.sigma.getCustomBBox() ?? target.sigma.getBBox();
  const placed = placeAddedNodes(target, desired, diff);
  withSigmaDetached(target.sigma, target.graph, () => {
    dropRemoved(target, diff);
    addNew(target, notes, diff, placed);
    restyleConnections(target, notes);
    applyDerived(target);
    holdFrame(target.sigma, frame);
  });
  // Detaching resets Sigma's hover target, so it would never emit leaveNode
  // for ours. Release it too; the next pointer move hovers afresh.
  target.tuning.hovered = null;
  // An orbit scene restages the batch into its slots instead.
  const force = target.tuning.graphMode === "constellation";
  if (force && isLargeBatch(diff.addedNodes.length, survivors)) {
    target.settleBatch?.(diff.addedNodes);
  }
  return "applied";
}

/**
 * Run graph mutations with Sigma parked on an empty copy of the graph, then
 * re-attach. In Sigma 3, every nodeDropped/edgeDropped event re-indexes the
 * whole graph synchronously (a refresh with no partialGraph), so dropping K
 * notes inline would cost O(K × (N + E)) reducer calls. The public setGraph
 * unbinds those handlers, and re-attaching runs one synchronous full refresh
 * with every change already in place.
 */
function withSigmaDetached(
  sigma: Sigma,
  graph: Graph,
  mutate: () => void,
): void {
  sigma.setGraph(graph.emptyCopy());
  try {
    mutate();
  } finally {
    sigma.setGraph(graph);
  }
}

type BBox = ReturnType<Sigma["getBBox"]>;

/**
 * Hold Sigma's normalization frame at its pre-change extent. Sigma otherwise
 * refits its bbox to the node extent on every refresh, so a node joining or
 * leaving the rim would rescale the whole view under the camera. A node that
 * lands outside the frame stays reachable by panning; fit view, filters and
 * layout staging all reset the frame explicitly.
 */
function holdFrame(sigma: Sigma, frame: BBox): void {
  const [x0, x1] = frame.x;
  const [y0, y1] = frame.y;
  // A degenerate frame (one node) normalizes by 1 graph unit; let Sigma fit.
  if (!(Math.max(x1 - x0, y1 - y0) > 0)) return;
  sigma.setCustomBBox({ x: [x0, x1], y: [y0, y1] });
}

interface Placement {
  /** Constellation homes for the new nodes. */
  homes: Map<string, XY>;
  /** Where they appear now: the homes, or beside their neighbors' current
   * scene positions while an orbit scene is on stage. */
  live: Map<string, XY>;
}

function placeAddedNodes(
  target: GraphSyncTarget,
  desired: DesiredStructure,
  diff: StructureDiff,
): Placement {
  const { graph, tuning, random } = target;
  if (diff.addedNodes.length === 0) {
    return { homes: new Map(), live: new Map() };
  }
  const adjacency = adjacencyFor(desired, diff.addedNodes);
  const neighborsOf = (id: string): string[] => adjacency.get(id) ?? [];
  const homes = new Map<string, XY>();
  const current = new Map<string, XY>();
  graph.forEachNode((id, attrs) => {
    if (!desired.ids.has(id)) return;
    const live = { x: attrs["x"] as number, y: attrs["y"] as number };
    current.set(id, live);
    homes.set(id, target.basePositionsRef.current.get(id) ?? live);
  });
  const frame = measureLayoutFrame(homes.values());
  const placed = placeNewNodes(diff.addedNodes, neighborsOf, homes, {
    frame,
    random,
  });
  relaxNewNodes(placed, neighborsOf, homes, { frame });
  // An orbit scene owns the live positions; the scene restage tweens each
  // new node from here into its slot.
  const live =
    tuning.graphMode === "orbit"
      ? placeNewNodes(diff.addedNodes, neighborsOf, current, { random })
      : placed;
  return { homes: placed, live };
}

function dropRemoved(target: GraphSyncTarget, diff: StructureDiff): void {
  const { graph, edgeExtremities } = target;
  for (const edge of diff.removedEdges) {
    graph.dropEdge(edge);
    edgeExtremities.delete(edge);
  }
  for (const id of diff.removedNodes) {
    graph.forEachEdge(id, (edge) => edgeExtremities.delete(edge));
    graph.dropNode(id);
    target.baseSizesRef.current.delete(id);
    target.basePositionsRef.current.delete(id);
    target.nodeZ.delete(id);
  }
}

function addNew(
  target: GraphSyncTarget,
  notes: Note[],
  diff: StructureDiff,
  placed: Placement,
): void {
  const { graph, tuning, edgeExtremities } = target;
  const ctx: NodeContext = {
    paint: tuning.nodeColor,
    communityOf: tuning.communityOf,
  };
  const bg = readCssVar("--bg-base", "#f5f1e8");
  const conn = connectionCounts(notes);
  const byId = new Map(notes.map((n) => [n.id, n]));
  for (const id of diff.addedNodes) {
    const attrs = nodeAttributesFor(byId.get(id)!, conn.get(id) ?? 0, ctx, bg);
    const home = placed.homes.get(id)!;
    const live = placed.live.get(id) ?? home;
    // Sigma indexes a node the moment it is added, so it must arrive with
    // its position and size already set.
    graph.addNode(id, {
      ...attrs,
      x: live.x,
      y: live.y,
      size: attrs.size * tuning.sizeScale,
    });
    target.baseSizesRef.current.set(id, attrs.size);
    target.basePositionsRef.current.set(id, { ...home });
    target.nodeZ.set(id, attrs.z);
  }
  for (const [source, targetId] of diff.addedEdges) {
    const edge = graph.addEdge(source, targetId);
    edgeExtremities.set(edge, [source, targetId]);
  }
}

/** Size and depth follow a node's link count; refresh the existing nodes
 * whose count moved. */
function restyleConnections(target: GraphSyncTarget, notes: Note[]): void {
  const { graph, tuning, nodeZ } = target;
  const baseSizes = target.baseSizesRef.current;
  const bg = readCssVar("--bg-base", "#f5f1e8");
  const conn = connectionCounts(notes);
  for (const n of notes) {
    if (!graph.hasNode(n.id)) continue;
    const c = conn.get(n.id) ?? 0;
    const unchanged =
      baseSizes.get(n.id) === baseSizeFor(c) &&
      nodeZ.get(n.id) === zForNode(n.id, c);
    if (unchanged) continue;
    const v = nodeVisualsFor(n.id, tuning.nodeColor(n.id, n.type), c, bg);
    baseSizes.set(n.id, v.size);
    nodeZ.set(n.id, v.z);
    graph.mergeNodeAttributes(n.id, {
      ...v,
      size: v.size * tuning.sizeScale,
    });
  }
}

/** Visibility, label degrees and overlays for the new structure. Runs while
 * Sigma is detached; re-attaching repaints everything once. */
function applyDerived(target: GraphSyncTarget): void {
  const { graph, sigma, tuning } = target;
  const visibility = applyGraphVisibility(graph, {
    filter: tuning.filter,
    selectedId: tuning.selected,
    isolateNeighbors: tuning.isolateNeighbors,
  });
  tuning.visibilityRestricted = visibility.restricted;
  tuning.degree = computeVisibleDegreeMap(graph);
  // setSetting schedules another full refresh; only pay for it on a change.
  const renderLabels = visibility.visibleCount <= GRAPH_LABEL_BUDGET_NODES;
  if (sigma.getSetting("renderLabels") !== renderLabels) {
    sigma.setSetting("renderLabels", renderLabels);
  }
  target.travelers?.sync();
}

/**
 * Patch content changes (title, type, folder, status, dates) onto existing
 * nodes. Returns whether anything changed, and whether a change can affect
 * visibility (so the filter must be re-applied).
 */
export function patchGraphContent(
  graph: Graph,
  notes: Note[],
  ctx: NodeContext,
): { changed: boolean; typeChanged: boolean } {
  const bg = readCssVar("--bg-base", "#f5f1e8");
  let changed = false;
  let typeChanged = false;
  for (const n of notes) {
    if (!graph.hasNode(n.id)) continue;
    if (graph.getNodeAttribute(n.id, "label") !== n.title) {
      graph.setNodeAttribute(n.id, "label", n.title);
      changed = true;
    }
    const filterAttrs = filterAttributesFor(n, ctx.communityOf);
    const attrs = graph.getNodeAttributes(n.id);
    const filterChanged = Object.entries(filterAttrs).some(
      ([k, v]) => !Object.is(attrs[k], v),
    );
    if (graph.getNodeAttribute(n.id, "noteType") !== n.type || filterChanged) {
      const z = (attrs["z"] as number | undefined) ?? 0;
      const color = ctx.paint(n.id, n.type);
      graph.mergeNodeAttributes(n.id, {
        ...filterAttrs,
        noteType: n.type,
        color,
        depthColor: depthColorFor(color, bg, z),
      });
      changed = true;
      typeChanged = true;
    }
  }
  return { changed, typeChanged };
}

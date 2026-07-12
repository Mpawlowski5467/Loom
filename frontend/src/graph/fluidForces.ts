import type Graph from "graphology";
import type { XY } from "./layouts";

/**
 * Pure building blocks for the fluid drag simulation (fluidSim.ts):
 * participant selection (BFS neighborhood with a whole-graph budget), body /
 * edge-spring construction from HOME positions, and grid-based short-range
 * repulsion. Kept separate so the force math stays testable and the sim file
 * stays small.
 */

/** Small graphs can move as one elastic sheet. Larger graphs stay local so
 * renderer work remains inside a frame even at the 500-node UI boundary. */
export const FULL_SIM_BUDGET = 120;
export const MAX_HOPS = 3;
export const MAX_PARTICIPANTS = 120;
/** Home-anchor spring strength by hop distance from the dragged node. */
export const ANCHOR_BY_HOP = [0, 0.01, 0.02, 0.04];
const REPULSE_PADDING_PX = 4;
const MAX_REPULSE = 6;
/** Nominal viewport edge (px) the layout bbox maps onto (see overlap.ts). */
const NOMINAL_VIEWPORT_PX = 900;

export interface Body {
  id: string;
  /** Live Graphology attribute object. Mutating x/y here avoids emitting one
   * nodeAttributesUpdated event per coordinate; fluidSim batches the renderer
   * update once per animation frame instead. */
  attrs: Record<string, unknown>;
  home: XY;
  x: number;
  y: number;
  vx: number;
  vy: number;
  anchorK: number;
  radius: number;
}

export interface EdgeSpring {
  a: number;
  b: number;
  rest: number;
}

export interface SpringNetwork {
  springs: EdgeSpring[];
  /** Every edge incident to a participant. These all need repainting when a
   * participant moves, even when the other endpoint is outside the sim. */
  affectedEdges: string[];
}

function bfsHops(
  graph: Graph,
  start: string,
  limit: number,
): Map<string, number> {
  const hops = new Map<string, number>([[start, 0]]);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length && hops.size < limit) {
    const cur = queue[head++]!;
    const d = hops.get(cur)!;
    if (d >= MAX_HOPS) continue;

    // someNeighbor stops iterating as soon as its predicate returns true. This
    // matters for a high-degree hub: forEachNeighbor would still walk all 50k
    // neighbors after the participant budget had already been filled.
    graph.someNeighbor(cur, (n) => {
      if (hops.has(n)) return;
      if (graph.getNodeAttribute(n, "hidden")) return;
      hops.set(n, d + 1);
      queue.push(n);
      return hops.size >= limit;
    });
  }
  return hops;
}

/** Participant ids → hop distance (clamped to the anchor table's last slot). */
export function collectParticipants(
  graph: Graph,
  draggedId: string,
): Map<string, number> {
  const maxHop = ANCHOR_BY_HOP.length - 1;
  if (graph.order <= FULL_SIM_BUDGET) {
    const hops = bfsHops(graph, draggedId, graph.order);
    const all = new Map<string, number>();
    graph.forEachNode((id) => {
      if (id !== draggedId && graph.getNodeAttribute(id, "hidden")) return;
      all.set(id, Math.min(hops.get(id) ?? maxHop, maxHop));
    });
    return all;
  }
  // The traversal itself is bounded, not merely the returned Map. Map keeps
  // BFS insertion order, so the retained participants are the closest ones.
  const near = bfsHops(graph, draggedId, MAX_PARTICIPANTS);
  for (const [id, d] of near) near.set(id, Math.min(d, maxHop));
  return near;
}

/** Bodies with the dragged node first, homes from ``getHome`` (or attrs). */
export function makeBodies(
  graph: Graph,
  draggedId: string,
  getHome: (id: string) => XY | undefined,
): Body[] {
  const hopMap = collectParticipants(graph, draggedId);
  const ids = [
    draggedId,
    ...[...hopMap.keys()].filter((id) => id !== draggedId),
  ];
  return ids.map((id) => {
    const attrs = graph.getNodeAttributes(id) as Record<string, unknown>;
    const x = (attrs["x"] as number) || 0;
    const y = (attrs["y"] as number) || 0;
    const home = getHome(id) ?? { x, y };
    return {
      id,
      attrs,
      home: { x: home.x, y: home.y },
      x,
      y,
      vx: 0,
      vy: 0,
      anchorK: ANCHOR_BY_HOP[hopMap.get(id) ?? ANCHOR_BY_HOP.length - 1]!,
      radius: (attrs["size"] as number) || 4,
    };
  });
}

/**
 * Build participant springs and the renderer's affected-edge list by walking
 * only edges incident to participant nodes. This avoids an O(all graph edges)
 * scan on every pointer-down in a large vault.
 */
export function makeSpringNetwork(graph: Graph, bodies: Body[]): SpringNetwork {
  const index = new Map(bodies.map((b, i) => [b.id, i]));
  const springs: EdgeSpring[] = [];
  const affectedEdges = new Set<string>();

  for (const body of bodies) {
    graph.forEachEdge(body.id, (edge, _attrs, source, target) => {
      if (affectedEdges.has(edge)) return;
      // An incident edge with a filtered endpoint is not rendered and its
      // hidden endpoint cannot participate, so exclude it before building the
      // renderer's partial-refresh set as well as the spring set.
      if (
        graph.getNodeAttribute(source, "hidden") ||
        graph.getNodeAttribute(target, "hidden")
      ) {
        return;
      }
      affectedEdges.add(edge);

      const a = index.get(source);
      const b = index.get(target);
      if (a === undefined || b === undefined || a === b) return;
      const rest = Math.hypot(
        bodies[b]!.home.x - bodies[a]!.home.x,
        bodies[b]!.home.y - bodies[a]!.home.y,
      );
      springs.push({ a, b, rest });
    });
  }

  return { springs, affectedEdges: [...affectedEdges] };
}

/** Graph units per rendered pixel, estimated from the participant bbox. */
export function unitsPerPxOf(bodies: Body[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of bodies) {
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.y > maxY) maxY = b.y;
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  return extent > 0 ? extent / NOMINAL_VIEWPORT_PX : 1;
}

// Reused across ticks: building a fresh Map, a template-string key per body,
// and new bucket arrays every 33ms tick churned ~30k short-lived allocations
// per second on a full-budget drag — GC pressure landing exactly where frame
// hitches are most visible. Buckets persist here; `_used` records which ones
// the previous call filled so they're emptied (not reallocated) on the next,
// and stale indices can never leak between ticks.
const _grid = new Map<number, number[]>();
const _used: number[] = [];
const _GRID_OFF = 1 << 15; // supports cell coords in ±32768 — far beyond any layout
const _GRID_STRIDE = 1 << 16;

function gridKey(cx: number, cy: number): number {
  return (cx + _GRID_OFF) * _GRID_STRIDE + (cy + _GRID_OFF);
}

/** Short-range pair repulsion via a (persistent) spatial grid, force clamped. */
export function applyRepulsion(
  bodies: Body[],
  fx: Float64Array,
  fy: Float64Array,
  unitsPerPx: number,
): void {
  let maxR = 0;
  for (const b of bodies) if (b.radius > maxR) maxR = b.radius;
  const cell = Math.max((2 * maxR + REPULSE_PADDING_PX) * unitsPerPx, 1e-6);
  for (const k of _used) _grid.get(k)!.length = 0;
  _used.length = 0;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    const key = gridKey(Math.floor(b.x / cell), Math.floor(b.y / cell));
    let bucket = _grid.get(key);
    if (bucket === undefined) {
      bucket = [];
      _grid.set(key, bucket);
    }
    if (bucket.length === 0) _used.push(key);
    bucket.push(i);
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = _grid.get(gridKey(cx + ox, cy + oy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = bodies[j]!;
          const sep = (a.radius + b.radius + REPULSE_PADDING_PX) * unitsPerPx;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= sep) continue;
          const ux = dist > 1e-6 ? dx / dist : 1;
          const uy = dist > 1e-6 ? dy / dist : 0;
          const push = Math.min((sep - dist) * 0.5, MAX_REPULSE);
          fx[i]! -= ux * push;
          fy[i]! -= uy * push;
          fx[j]! += ux * push;
          fy[j]! += uy * push;
        }
      }
    }
  }
}

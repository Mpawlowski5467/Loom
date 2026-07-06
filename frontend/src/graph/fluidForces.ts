import type Graph from "graphology";
import type { XY } from "./layouts";

/**
 * Pure building blocks for the fluid drag simulation (fluidSim.ts):
 * participant selection (BFS neighborhood with a whole-graph budget), body /
 * edge-spring construction from HOME positions, and grid-based short-range
 * repulsion. Kept separate so the force math stays testable and the sim file
 * stays small.
 */

/** Whole-graph participation up to this order; larger graphs use a BFS cut. */
export const FULL_SIM_BUDGET = 500;
export const MAX_HOPS = 3;
export const MAX_PARTICIPANTS = 400;
/** Home-anchor spring strength by hop distance from the dragged node. */
export const ANCHOR_BY_HOP = [0, 0.01, 0.02, 0.04];
const REPULSE_PADDING_PX = 4;
const MAX_REPULSE = 6;
/** Nominal viewport edge (px) the layout bbox maps onto (see overlap.ts). */
const NOMINAL_VIEWPORT_PX = 900;

export interface Body {
  id: string;
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

function bfsHops(graph: Graph, start: string): Map<string, number> {
  const hops = new Map<string, number>([[start, 0]]);
  const queue: string[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = hops.get(cur)!;
    if (d >= MAX_HOPS) continue;
    graph.forEachNeighbor(cur, (n) => {
      if (hops.has(n)) return;
      if (graph.getNodeAttribute(n, "hidden")) return;
      hops.set(n, d + 1);
      queue.push(n);
    });
  }
  return hops;
}

/** Participant ids → hop distance (clamped to the anchor table's last slot). */
export function collectParticipants(
  graph: Graph,
  draggedId: string,
): Map<string, number> {
  const hops = bfsHops(graph, draggedId);
  const maxHop = ANCHOR_BY_HOP.length - 1;
  if (graph.order <= FULL_SIM_BUDGET) {
    const all = new Map<string, number>();
    graph.forEachNode((id) => {
      if (id !== draggedId && graph.getNodeAttribute(id, "hidden")) return;
      all.set(id, Math.min(hops.get(id) ?? maxHop, maxHop));
    });
    return all;
  }
  // Budget cut: Map preserves BFS insertion order, so this keeps the closest.
  const near = new Map<string, number>();
  for (const [id, d] of hops) {
    near.set(id, Math.min(d, maxHop));
    if (near.size >= MAX_PARTICIPANTS) break;
  }
  return near;
}

/** Bodies with the dragged node first, homes from ``getHome`` (or attrs). */
export function makeBodies(
  graph: Graph,
  draggedId: string,
  getHome: (id: string) => XY | undefined,
): Body[] {
  const hopMap = collectParticipants(graph, draggedId);
  const ids = [draggedId, ...[...hopMap.keys()].filter((id) => id !== draggedId)];
  return ids.map((id) => {
    const x = (graph.getNodeAttribute(id, "x") as number) || 0;
    const y = (graph.getNodeAttribute(id, "y") as number) || 0;
    const home = getHome(id) ?? { x, y };
    return {
      id,
      home: { x: home.x, y: home.y },
      x,
      y,
      vx: 0,
      vy: 0,
      anchorK: ANCHOR_BY_HOP[hopMap.get(id) ?? ANCHOR_BY_HOP.length - 1]!,
      radius: (graph.getNodeAttribute(id, "size") as number) || 4,
    };
  });
}

/** Springs between participants; rest = distance between HOME positions. */
export function makeSprings(graph: Graph, bodies: Body[]): EdgeSpring[] {
  const index = new Map(bodies.map((b, i) => [b.id, i]));
  const springs: EdgeSpring[] = [];
  graph.forEachEdge((_edge, _attrs, source, target) => {
    const a = index.get(source);
    const b = index.get(target);
    if (a === undefined || b === undefined || a === b) return;
    const rest = Math.hypot(
      bodies[b]!.home.x - bodies[a]!.home.x,
      bodies[b]!.home.y - bodies[a]!.home.y,
    );
    springs.push({ a, b, rest });
  });
  return springs;
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

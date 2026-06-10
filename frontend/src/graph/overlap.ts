import type Graph from "graphology";
import { hash01 } from "./depth";

/**
 * Deterministic node-overlap relaxation, run after ForceAtlas2 settles.
 *
 * FA2 has no collision term, so dense vaults end up with stacked disks. This
 * pass nudges any pair closer than the sum of their rendered radii apart over
 * a few damped Jacobi sweeps (full-strength pushes make stacked nodes
 * leapfrog and oscillate), using a spatial grid so each sweep is ~O(n). Node
 * ``size`` attrs are viewport pixels while positions are graph units; Sigma
 * fits the layout bbox to the viewport, so the px→unit scale is estimated
 * from the bbox extent against a nominal viewport.
 */

const MAX_PASSES = 50;
const PADDING_PX = 4;
/** Nominal viewport edge (px) the layout bbox is assumed to map onto. */
const NOMINAL_VIEWPORT_PX = 900;
/** Damping divisor on each sweep's accumulated displacement. */
const SPEED = 3;

interface Field {
  /** Sorted ids → deterministic sweep order regardless of insertion order. */
  ids: string[];
  xs: Map<string, number>;
  ys: Map<string, number>;
  radii: Map<string, number>;
  /** Graph units per rendered pixel (bbox extent over nominal viewport). */
  unitsPerPx: number;
  /** Spatial-grid cell edge: the largest possible colliding separation. */
  cell: number;
}

function snapshotField(graph: Graph, paddingPx: number): Field {
  const ids = graph.nodes().slice().sort();
  const xs = new Map<string, number>();
  const ys = new Map<string, number>();
  const radii = new Map<string, number>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxRadius = 0;
  for (const id of ids) {
    const x = (graph.getNodeAttribute(id, "x") as number) || 0;
    const y = (graph.getNodeAttribute(id, "y") as number) || 0;
    const size = (graph.getNodeAttribute(id, "size") as number) || 4;
    xs.set(id, x);
    ys.set(id, y);
    radii.set(id, size);
    if (size > maxRadius) maxRadius = size;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  const unitsPerPx = extent > 0 ? extent / NOMINAL_VIEWPORT_PX : 1;
  const cell = Math.max((2 * maxRadius + paddingPx) * unitsPerPx, 1e-6);
  return { ids, xs, ys, radii, unitsPerPx, cell };
}

/** One damped Jacobi sweep: accumulate pair pushes, apply at 1/SPEED.
 * Returns false when no pair collided (converged). */
function sweepOnce(f: Field, paddingPx: number): boolean {
  const { ids, xs, ys, radii, unitsPerPx, cell } = f;
  const grid = new Map<string, string[]>();
  const order = new Map<string, number>();
  const dxAcc = new Map<string, number>();
  const dyAcc = new Map<string, number>();
  ids.forEach((id, i) => {
    order.set(id, i);
    dxAcc.set(id, 0);
    dyAcc.set(id, 0);
    const key = `${Math.floor(xs.get(id)! / cell)}:${Math.floor(ys.get(id)! / cell)}`;
    const bucket = grid.get(key) ?? [];
    bucket.push(id);
    grid.set(key, bucket);
  });

  let moved = false;
  for (const a of ids) {
    const ax = xs.get(a)!;
    const ay = ys.get(a)!;
    const cx = Math.floor(ax / cell);
    const cy = Math.floor(ay / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(`${cx + ox}:${cy + oy}`);
        if (!bucket) continue;
        for (const b of bucket) {
          // Handle each pair once per sweep.
          if (order.get(b)! <= order.get(a)!) continue;
          const sep = (radii.get(a)! + radii.get(b)! + paddingPx) * unitsPerPx;
          const dx = xs.get(b)! - ax;
          const dy = ys.get(b)! - ay;
          const dist = Math.hypot(dx, dy);
          if (dist >= sep) continue;
          moved = true;
          let ux: number;
          let uy: number;
          if (dist > 1e-6) {
            ux = dx / dist;
            uy = dy / dist;
          } else {
            // Coincident pair: split along a deterministic angle.
            const angle = hash01(`${a}|${b}`) * Math.PI * 2;
            ux = Math.cos(angle);
            uy = Math.sin(angle);
          }
          const push = (sep - dist) / 2;
          dxAcc.set(a, dxAcc.get(a)! - ux * push);
          dyAcc.set(a, dyAcc.get(a)! - uy * push);
          dxAcc.set(b, dxAcc.get(b)! + ux * push);
          dyAcc.set(b, dyAcc.get(b)! + uy * push);
        }
      }
    }
  }
  if (!moved) return false;
  for (const id of ids) {
    xs.set(id, xs.get(id)! + dxAcc.get(id)! / SPEED);
    ys.set(id, ys.get(id)! + dyAcc.get(id)! / SPEED);
  }
  return true;
}

export function resolveOverlaps(
  graph: Graph,
  opts?: { passes?: number; paddingPx?: number },
): void {
  const passes = opts?.passes ?? MAX_PASSES;
  const paddingPx = opts?.paddingPx ?? PADDING_PX;
  if (graph.order < 2) return;

  const field = snapshotField(graph, paddingPx);
  for (let pass = 0; pass < passes; pass++) {
    if (!sweepOnce(field, paddingPx)) break;
  }
  for (const id of field.ids) {
    graph.setNodeAttribute(id, "x", field.xs.get(id)!);
    graph.setNodeAttribute(id, "y", field.ys.get(id)!);
  }
}

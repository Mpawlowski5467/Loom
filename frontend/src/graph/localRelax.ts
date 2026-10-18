import { hash01 } from "./depth";
import type { XY } from "./orbitScenes";
import { measureLayoutFrame, type LayoutFrame } from "./placement";

/**
 * Bounded settling for freshly placed nodes, used in place of a ForceAtlas2
 * pass when nodes join an existing layout. Only the new nodes move. Each one
 * is pulled by springs toward its neighbors (rest length = the layout's
 * typical spacing) and pushed off any node within reach. Every other node
 * stays fixed, so the rest of the layout is returned unchanged. The cost is
 * O(iterations × new nodes × local density), and the spatial grid means it
 * never sweeps the whole graph per step.
 */

const ITERATIONS = 40;
/** Fraction of the mean spring error corrected per step. */
const SPRING_STEP = 0.35;
/** Repulsion reach as a multiple of spacing. */
const REPEL_RANGE = 0.9;
/** Fraction of the overlap removed per step, per neighbor in reach. */
const REPEL_STEP = 0.5;
/** Per-step displacement cap as a multiple of spacing. */
const MAX_STEP = 0.5;
const COOLING = 0.93;

export interface RelaxOptions {
  iterations?: number;
  /** Frame of the fixed layout. Measured from ``fixed`` when omitted. */
  frame?: LayoutFrame;
}

interface GridPoint {
  x: number;
  y: number;
  /** Index into the movable arrays, or -1 for a fixed node. */
  i: number;
}

type Grid = Map<string, GridPoint[]>;

function cellKey(x: number, y: number, cell: number): string {
  return `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
}

function addToGrid(grid: Grid, p: GridPoint, cell: number): void {
  const key = cellKey(p.x, p.y, cell);
  const bucket = grid.get(key);
  if (bucket) bucket.push(p);
  else grid.set(key, [p]);
}

function forEachNear(
  grid: Grid,
  x: number,
  y: number,
  cell: number,
  fn: (p: GridPoint) => void,
): void {
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const bucket = grid.get(`${cx + ox}:${cy + oy}`);
      if (bucket) for (const p of bucket) fn(p);
    }
  }
}

interface Field {
  ids: string[];
  xs: Float64Array;
  ys: Float64Array;
  /** Per movable node: neighbor indices (>= 0) or fixed neighbor XYs. */
  springs: Array<Array<number | XY>>;
  fixedGrid: Grid;
  spacing: number;
  reach: number;
}

function makeField(
  movable: ReadonlyMap<string, XY>,
  neighborsOf: (id: string) => Iterable<string>,
  fixed: ReadonlyMap<string, XY>,
  spacing: number,
): Field {
  const ids = [...movable.keys()];
  const index = new Map(ids.map((id, i) => [id, i]));
  const reach = spacing * REPEL_RANGE;
  const fixedGrid: Grid = new Map();
  for (const p of fixed.values()) {
    addToGrid(fixedGrid, { x: p.x, y: p.y, i: -1 }, reach);
  }
  const springs = ids.map((id) => {
    const out: Array<number | XY> = [];
    for (const nb of neighborsOf(id)) {
      if (nb === id) continue;
      const j = index.get(nb);
      const anchor = j === undefined ? fixed.get(nb) : j;
      if (anchor !== undefined) out.push(anchor);
    }
    return out;
  });
  return {
    ids,
    xs: Float64Array.from(ids, (id) => movable.get(id)!.x),
    ys: Float64Array.from(ids, (id) => movable.get(id)!.y),
    springs,
    fixedGrid,
    spacing,
    reach,
  };
}

/** Mean spring correction toward rest length, scaled by SPRING_STEP. */
function springPull(f: Field, i: number): XY {
  const anchors = f.springs[i]!;
  if (anchors.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const a of anchors) {
    const qx = typeof a === "number" ? f.xs[a]! : a.x;
    const qy = typeof a === "number" ? f.ys[a]! : a.y;
    const dx = qx - f.xs[i]!;
    const dy = qy - f.ys[i]!;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) continue; // coincident: repulsion separates them first
    const err = d - f.spacing;
    sx += (dx / d) * err;
    sy += (dy / d) * err;
  }
  const k = SPRING_STEP / anchors.length;
  return { x: sx * k, y: sy * k };
}

/** Summed push away from every node (fixed or moving) within reach. */
function repulsion(f: Field, i: number, moving: Grid): XY {
  const x = f.xs[i]!;
  const y = f.ys[i]!;
  let sx = 0;
  let sy = 0;
  const push = (p: GridPoint): void => {
    if (p.i === i) return;
    const dx = x - p.x;
    const dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d >= f.reach) return;
    let ux: number;
    let uy: number;
    if (d > 1e-9) {
      ux = dx / d;
      uy = dy / d;
    } else {
      // Coincident pair: split along a deterministic angle. The two moving
      // members take opposite signs so they separate instead of co-moving.
      const self = f.ids[i]!;
      const other = p.i >= 0 ? f.ids[p.i]! : "";
      const [lo, hi] = self < other ? [self, other] : [other, self];
      const angle = hash01(`${lo}|${hi}`) * Math.PI * 2;
      const sign = self === lo ? 1 : -1;
      ux = Math.cos(angle) * sign;
      uy = Math.sin(angle) * sign;
    }
    sx += ux * (f.reach - d) * REPEL_STEP;
    sy += uy * (f.reach - d) * REPEL_STEP;
  };
  forEachNear(f.fixedGrid, x, y, f.reach, push);
  forEachNear(moving, x, y, f.reach, push);
  return { x: sx, y: sy };
}

function step(f: Field, alpha: number): void {
  const moving: Grid = new Map();
  for (let i = 0; i < f.ids.length; i++) {
    addToGrid(moving, { x: f.xs[i]!, y: f.ys[i]!, i }, f.reach);
  }
  const maxStep = f.spacing * MAX_STEP;
  const dx = new Float64Array(f.ids.length);
  const dy = new Float64Array(f.ids.length);
  for (let i = 0; i < f.ids.length; i++) {
    const s = springPull(f, i);
    const r = repulsion(f, i, moving);
    let mx = (s.x + r.x) * alpha;
    let my = (s.y + r.y) * alpha;
    const len = Math.hypot(mx, my);
    if (len > maxStep) {
      mx = (mx / len) * maxStep;
      my = (my / len) * maxStep;
    }
    dx[i] = mx;
    dy[i] = my;
  }
  for (let i = 0; i < f.ids.length; i++) {
    f.xs[i]! += dx[i]!;
    f.ys[i]! += dy[i]!;
  }
}

/**
 * Relax the ``movable`` nodes against the ``fixed`` layout, updating
 * ``movable`` in place. Fixed nodes are never written.
 */
export function relaxNewNodes(
  movable: Map<string, XY>,
  neighborsOf: (id: string) => Iterable<string>,
  fixed: ReadonlyMap<string, XY>,
  opts: RelaxOptions = {},
): void {
  if (movable.size === 0) return;
  const frame = opts.frame ?? measureLayoutFrame(fixed.values());
  const field = makeField(movable, neighborsOf, fixed, frame.spacing);
  const iterations = opts.iterations ?? ITERATIONS;
  let alpha = 1;
  for (let it = 0; it < iterations; it++) {
    step(field, alpha);
    alpha *= COOLING;
  }
  field.ids.forEach((id, i) => {
    movable.set(id, { x: field.xs[i]!, y: field.ys[i]! });
  });
}

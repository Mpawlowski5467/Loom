import type { XY } from "./orbitScenes";

/**
 * Seeding for nodes that join an already laid-out graph, modeled on
 * Obsidian's graph renderer. A new node starts at the centroid of its placed
 * neighbors plus a jitter that grows with sqrt(new-node count), so a batch of
 * k arrivals spreads over an area proportional to k. A node with no placed
 * neighbor goes to a random point in a ring just outside the current layout
 * radius. Fresh builds keep the golden-angle spiral in layouts.ts.
 */

export interface LayoutFrame {
  /** Centroid of the placed nodes. */
  cx: number;
  cy: number;
  /** Largest distance from the centroid to a placed node. */
  radius: number;
  /** Typical gap between neighbors: the edge of the square cell each node
   * would own if the placed nodes filled the disk evenly. */
  spacing: number;
}

/** Spacing used when there are too few placed nodes to measure one. It
 * matches the step of the fresh-build spiral. */
export const FALLBACK_SPACING = 50;
/** Jitter radius per sqrt(new node), in units of ``spacing``. */
const JITTER_FACTOR = 0.6;
/** Orphan ring bounds, as multiples of the layout radius. */
const RING_INNER = 1.04;
const RING_OUTER = 1.14;

export function measureLayoutFrame(positions: Iterable<XY>): LayoutFrame {
  const points = [...positions];
  if (points.length === 0) {
    return { cx: 0, cy: 0, radius: 0, spacing: FALLBACK_SPACING };
  }
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / points.length;
  const cy = sy / points.length;
  let radius = 0;
  for (const p of points) {
    radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy));
  }
  const spacing =
    points.length > 1 && radius > 0
      ? radius * Math.sqrt(Math.PI / points.length)
      : FALLBACK_SPACING;
  return { cx, cy, radius, spacing };
}

export interface PlacementOptions {
  /** Defaults to Math.random. Tests pass a seeded generator. */
  random?: () => number;
  /** Precomputed frame of ``known``. */
  frame?: LayoutFrame;
}

/**
 * Position every id in ``newIds``. ``known`` holds the nodes that are
 * already placed. A node placed earlier in the same call counts as placed for
 * later ones, so a new cluster forms around its first member instead of
 * scattering across the ring.
 */
export function placeNewNodes(
  newIds: readonly string[],
  neighborsOf: (id: string) => Iterable<string>,
  known: ReadonlyMap<string, XY>,
  opts: PlacementOptions = {},
): Map<string, XY> {
  const random = opts.random ?? Math.random;
  const frame = opts.frame ?? measureLayoutFrame(known.values());
  const jitter = frame.spacing * JITTER_FACTOR * Math.sqrt(newIds.length);
  const placed = new Map<string, XY>();
  const lookup = (id: string): XY | undefined =>
    placed.get(id) ?? known.get(id);

  let pending = [...newIds];
  while (pending.length > 0) {
    pending = placeBesideNeighbors(pending, (id) => {
      const centroid = centroidOf(id, neighborsOf(id), lookup);
      if (!centroid) return false;
      placed.set(id, pointInDisk(centroid, jitter, random));
      return true;
    });
    // No pending node touches a placed one: seed the first on the ring and
    // let its own neighbors cluster around it on the next sweep.
    const orphan = pending.shift();
    if (orphan !== undefined) placed.set(orphan, ringPoint(frame, random));
  }
  return placed;
}

/** Sweep ``pending`` until no further node can be placed; returns the rest. */
function placeBesideNeighbors(
  pending: string[],
  tryPlace: (id: string) => boolean,
): string[] {
  let rest = pending;
  let progressed = true;
  while (progressed && rest.length > 0) {
    progressed = false;
    const next: string[] = [];
    for (const id of rest) {
      if (tryPlace(id)) progressed = true;
      else next.push(id);
    }
    rest = next;
  }
  return rest;
}

function centroidOf(
  id: string,
  neighbors: Iterable<string>,
  lookup: (id: string) => XY | undefined,
): XY | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const nb of neighbors) {
    if (nb === id) continue;
    const p = lookup(nb);
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

/** Uniform sample from the disk of ``radius`` around ``center``. */
function pointInDisk(center: XY, radius: number, random: () => number): XY {
  const angle = random() * Math.PI * 2;
  const r = radius * Math.sqrt(random());
  return {
    x: center.x + Math.cos(angle) * r,
    y: center.y + Math.sin(angle) * r,
  };
}

function ringPoint(frame: LayoutFrame, random: () => number): XY {
  const base = Math.max(frame.radius, frame.spacing);
  const angle = random() * Math.PI * 2;
  const r = base * (RING_INNER + (RING_OUTER - RING_INNER) * random());
  return {
    x: frame.cx + Math.cos(angle) * r,
    y: frame.cy + Math.sin(angle) * r,
  };
}

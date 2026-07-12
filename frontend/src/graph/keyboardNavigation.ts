export type GraphArrowKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewportNodePoint extends ViewportPoint {
  readonly id: string;
}

export interface DirectionalNodeOptions {
  /** The selected node and its current viewport position, when there is one. */
  readonly selectedOrigin?: ViewportNodePoint | null;
  /** Used as the origin when no finite selected-node position is available. */
  readonly viewportCenter: ViewportPoint;
}

const PERPENDICULAR_WEIGHT = 2;

const DIRECTION_VECTORS: Record<GraphArrowKey, ViewportPoint> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

interface RankedNode {
  node: ViewportNodePoint;
  score: number;
  forward: number;
  perpendicular: number;
}

function isFinitePoint(point: ViewportPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareRank(a: RankedNode, b: RankedNode): number {
  return (
    a.score - b.score ||
    a.perpendicular - b.perpendicular ||
    a.forward - b.forward ||
    compareIds(a.node.id, b.node.id) ||
    a.node.x - b.node.x ||
    a.node.y - b.node.y
  );
}

/**
 * Pick the visible node that best matches an arrow-key direction.
 *
 * Distance along the requested axis keeps navigation local, while weighting
 * perpendicular distance favors nodes that visually line up with the origin.
 * Stable geometric and id tie-breakers make the result independent of input
 * order.
 */
export function findDirectionalNode(
  nodes: readonly ViewportNodePoint[],
  direction: GraphArrowKey,
  options: DirectionalNodeOptions,
): ViewportNodePoint | null {
  const selected = options.selectedOrigin;
  const origin =
    selected && isFinitePoint(selected) ? selected : options.viewportCenter;

  if (!isFinitePoint(origin)) return null;

  const vector = DIRECTION_VECTORS[direction];
  let best: RankedNode | null = null;

  for (const node of nodes) {
    if (node.id === selected?.id || !isFinitePoint(node)) continue;

    const dx = node.x - origin.x;
    const dy = node.y - origin.y;
    const forward = dx * vector.x + dy * vector.y;

    // Points on or behind the perpendicular plane are not in this direction.
    if (forward <= 0) continue;

    const perpendicular = Math.abs(dx * vector.y - dy * vector.x);
    const ranked: RankedNode = {
      node,
      forward,
      perpendicular,
      score: forward + perpendicular * PERPENDICULAR_WEIGHT,
    };

    if (!best || compareRank(ranked, best) < 0) best = ranked;
  }

  return best?.node ?? null;
}

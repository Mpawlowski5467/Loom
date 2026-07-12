import type Graph from "graphology";
import { hash01 } from "./depth";
import { computeVisibleDegreeMap, isGraphNodeVisible } from "./filtering";

export interface XY {
  x: number;
  y: number;
}

export type OrbitScene = "rings" | "spiral" | "arms" | "galaxy" | "wave";

export const ORBIT_SCENES: readonly OrbitScene[] = [
  "rings",
  "spiral",
  "arms",
  "galaxy",
  "wave",
] as const;

export const ORBIT_SCENE_LABELS: Record<OrbitScene, string> = {
  rings: "Rings",
  spiral: "Spiral",
  arms: "Arms",
  galaxy: "Galaxy",
  wave: "Wave",
};

const RADII = [0, 180, 320, 460, 600];
const OUTER_R = 700;

function resolveVisibleFocus(graph: Graph, requestedId: string): string | null {
  if (isGraphNodeVisible(graph, requestedId)) return requestedId;
  let fallback: string | null = null;
  graph.forEachNode((id) => {
    if (fallback === null && isGraphNodeVisible(graph, id)) fallback = id;
  });
  return fallback;
}

function bfsDistances(graph: Graph, focusId: string): Map<string, number> {
  const distances = new Map<string, number>();
  distances.set(focusId, 0);
  const queue: string[] = [focusId];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = distances.get(cur)!;
    if (d >= RADII.length - 1) continue;
    const ns = new Set<string>();
    graph.forEachOutNeighbor(cur, (n) => {
      if (isGraphNodeVisible(graph, n)) ns.add(n);
    });
    graph.forEachInNeighbor(cur, (n) => {
      if (isGraphNodeVisible(graph, n)) ns.add(n);
    });
    for (const n of ns) {
      if (!distances.has(n)) {
        distances.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return distances;
}

/** Nodes ordered focus-first, then by BFS distance asc, then degree desc —
 * the shared ranking for the path-like scenes (spiral, galaxy, wave). */
function orderByCloseness(
  graph: Graph,
  focusId: string,
  distances: Map<string, number>,
): string[] {
  const ordered: string[] = [];
  graph.forEachNode((id) => {
    if (isGraphNodeVisible(graph, id)) ordered.push(id);
  });
  const degree = computeVisibleDegreeMap(graph);
  ordered.sort((a, b) => {
    if (a === focusId) return -1;
    if (b === focusId) return 1;
    const da = distances.get(a) ?? RADII.length;
    const db = distances.get(b) ?? RADII.length;
    if (da !== db) return da - db;
    return (degree.get(b) ?? 0) - (degree.get(a) ?? 0);
  });
  return ordered;
}

function ringsScene(graph: Graph, focusId: string): Map<string, XY> {
  const distances = bfsDistances(graph, focusId);
  const byDist = new Map<number, string[]>();
  graph.forEachNode((id) => {
    if (!isGraphNodeVisible(graph, id)) return;
    const d = distances.get(id);
    const key = d === undefined ? RADII.length : d;
    const arr = byDist.get(key) ?? [];
    arr.push(id);
    byDist.set(key, arr);
  });
  const result = new Map<string, XY>();
  for (const [d, ids] of byDist) {
    if (d === 0) {
      result.set(ids[0]!, { x: 0, y: 0 });
      continue;
    }
    const r = d <= RADII.length - 1 ? RADII[d]! : OUTER_R;
    const N = ids.length;
    ids.forEach((id, i) => {
      const angle = (i / N) * Math.PI * 2;
      const jitter = N > 8 ? Math.sin(i * 2.7) * 20 : 0;
      result.set(id, {
        x: Math.cos(angle) * (r + jitter),
        y: Math.sin(angle) * (r + jitter),
      });
    });
  }
  return result;
}

function spiralScene(graph: Graph, focusId: string): Map<string, XY> {
  // Well-connected siblings sit "earlier" on the spiral arm; focus at the eye.
  const distances = bfsDistances(graph, focusId);
  const phi = Math.PI * (3 - Math.sqrt(5));
  const ordered = orderByCloseness(graph, focusId, distances);
  const result = new Map<string, XY>();
  const spacing = 55;
  ordered.forEach((id, k) => {
    if (id === focusId) {
      result.set(id, { x: 0, y: 0 });
      return;
    }
    const angle = k * phi;
    const r = Math.sqrt(k) * spacing;
    result.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });
  return result;
}

const TYPE_SECTORS: Record<string, number> = {
  project: 0,
  topic: Math.PI / 3,
  people: (2 * Math.PI) / 3,
  daily: Math.PI,
  capture: (4 * Math.PI) / 3,
  custom: (5 * Math.PI) / 3,
};

function armsScene(graph: Graph, focusId: string): Map<string, XY> {
  // Six angular sectors keyed off node type — same-type notes form "petals"
  // radiating from the focus. Radial position by BFS distance.
  const distances = bfsDistances(graph, focusId);
  const sectorWidth = Math.PI / 4;
  const buckets = new Map<string, string[]>();
  const noteType = (id: string): string =>
    (graph.getNodeAttribute(id, "noteType") as string | undefined) ?? "custom";
  graph.forEachNode((id) => {
    if (!isGraphNodeVisible(graph, id)) return;
    if (id === focusId) return;
    const d = distances.get(id) ?? RADII.length;
    const key = `${noteType(id)}:${d}`;
    const arr = buckets.get(key) ?? [];
    arr.push(id);
    buckets.set(key, arr);
  });
  const result = new Map<string, XY>();
  result.set(focusId, { x: 0, y: 0 });
  for (const [key, ids] of buckets) {
    const [type, distStr] = key.split(":");
    const d = Number(distStr);
    const sectorCenter = TYPE_SECTORS[type!] ?? 0;
    const r = d <= RADII.length - 1 ? RADII[d]! : OUTER_R;
    const N = ids.length;
    ids.forEach((id, i) => {
      const t = N === 1 ? 0 : i / (N - 1) - 0.5;
      const angle = sectorCenter + t * sectorWidth;
      result.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    });
  }
  return result;
}

const GALAXY_ARMS = 2;

function galaxyScene(graph: Graph, focusId: string): Map<string, XY> {
  // Two log-ish spiral arms winding out from the focus, close nodes near the
  // core. Hash-jittered so the arms read as star fields, not bead strings.
  const distances = bfsDistances(graph, focusId);
  const ordered = orderByCloseness(graph, focusId, distances);
  const result = new Map<string, XY>();
  ordered.forEach((id, k) => {
    if (id === focusId) {
      result.set(id, { x: 0, y: 0 });
      return;
    }
    const arm = (k - 1) % GALAXY_ARMS;
    const t = Math.floor((k - 1) / GALAXY_ARMS);
    const angle =
      arm * ((Math.PI * 2) / GALAXY_ARMS) +
      t * 0.26 +
      (hash01(id) - 0.5) * 0.24;
    const r = 70 * Math.sqrt(t + 1) + (hash01(`${id}/r`) - 0.5) * 56;
    result.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });
  return result;
}

function waveScene(graph: Graph, focusId: string): Map<string, XY> {
  // A horizontal sine ribbon: the focus sits at the crest center and nodes
  // fan out left/right by closeness, drifting along the wave.
  const distances = bfsDistances(graph, focusId);
  const ordered = orderByCloseness(graph, focusId, distances);
  const result = new Map<string, XY>();
  const spacing = 44;
  const amp = 150;
  const freq = (Math.PI * 2) / 720;
  ordered.forEach((id, k) => {
    if (id === focusId) {
      result.set(id, { x: 0, y: 0 });
      return;
    }
    const side = k % 2 === 0 ? 1 : -1;
    const x = side * Math.ceil(k / 2) * spacing;
    const y = Math.sin(x * freq) * amp + (hash01(id) - 0.5) * 44;
    result.set(id, { x, y });
  });
  return result;
}

export function computeOrbitScene(
  graph: Graph,
  focusId: string,
  scene: OrbitScene,
): Map<string, XY> {
  const visibleFocus = resolveVisibleFocus(graph, focusId);
  if (!visibleFocus) return new Map();
  switch (scene) {
    case "spiral":
      return spiralScene(graph, visibleFocus);
    case "arms":
      return armsScene(graph, visibleFocus);
    case "galaxy":
      return galaxyScene(graph, visibleFocus);
    case "wave":
      return waveScene(graph, visibleFocus);
    case "rings":
    default:
      return ringsScene(graph, visibleFocus);
  }
}

/** Legacy entry point — defaults to the Rings scene. */
export function computeOrbitLayout(
  graph: Graph,
  focusId: string,
): Map<string, XY> {
  return computeOrbitScene(graph, focusId, "rings");
}

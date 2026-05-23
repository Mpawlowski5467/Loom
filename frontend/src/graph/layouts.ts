import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

export interface XY {
  x: number;
  y: number;
}

export function applyConstellationLayout(graph: Graph): Map<string, XY> {
  // seed with golden-angle spiral so we get deterministic positions
  const phi = Math.PI * (3 - Math.sqrt(5));
  let i = 0;
  graph.forEachNode((id) => {
    const r = Math.sqrt(i + 1) * 50;
    const a = i * phi;
    graph.setNodeAttribute(id, "x", Math.cos(a) * r);
    graph.setNodeAttribute(id, "y", Math.sin(a) * r);
    i++;
  });
  forceAtlas2.assign(graph, {
    iterations: 220,
    settings: {
      ...forceAtlas2.inferSettings(graph),
      gravity: 0.6,
      scalingRatio: 8,
      slowDown: 8,
    },
  });
  const positions = new Map<string, XY>();
  graph.forEachNode((id, attrs) => {
    positions.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
  });
  return positions;
}

export type OrbitScene = "rings" | "spiral" | "arms";

export const ORBIT_SCENES: readonly OrbitScene[] = [
  "rings",
  "spiral",
  "arms",
] as const;

export const ORBIT_SCENE_LABELS: Record<OrbitScene, string> = {
  rings: "Rings",
  spiral: "Spiral",
  arms: "Arms",
};

const RADII = [0, 180, 320, 460, 600];
const OUTER_R = 700;

function bfsDistances(graph: Graph, focusId: string): Map<string, number> {
  const distances = new Map<string, number>();
  distances.set(focusId, 0);
  const queue: string[] = [focusId];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = distances.get(cur)!;
    if (d >= RADII.length - 1) continue;
    const ns = new Set<string>();
    graph.forEachOutNeighbor(cur, (n) => ns.add(n));
    graph.forEachInNeighbor(cur, (n) => ns.add(n));
    for (const n of ns) {
      if (!distances.has(n)) {
        distances.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return distances;
}

function ringsScene(graph: Graph, focusId: string): Map<string, XY> {
  const distances = bfsDistances(graph, focusId);
  const byDist = new Map<number, string[]>();
  graph.forEachNode((id) => {
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
  // Sort nodes by BFS distance, then by degree desc so well-connected siblings
  // sit "earlier" on the spiral arm. Focus pinned at the eye.
  const distances = bfsDistances(graph, focusId);
  const phi = Math.PI * (3 - Math.sqrt(5));
  const ordered: string[] = [];
  graph.forEachNode((id) => ordered.push(id));
  ordered.sort((a, b) => {
    if (a === focusId) return -1;
    if (b === focusId) return 1;
    const da = distances.get(a) ?? RADII.length;
    const db = distances.get(b) ?? RADII.length;
    if (da !== db) return da - db;
    return graph.degree(b) - graph.degree(a);
  });
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

export function computeOrbitScene(
  graph: Graph,
  focusId: string,
  scene: OrbitScene,
): Map<string, XY> {
  switch (scene) {
    case "spiral":
      return spiralScene(graph, focusId);
    case "arms":
      return armsScene(graph, focusId);
    case "rings":
    default:
      return ringsScene(graph, focusId);
  }
}

/** Legacy entry point — defaults to the Rings scene. */
export function computeOrbitLayout(
  graph: Graph,
  focusId: string,
): Map<string, XY> {
  return ringsScene(graph, focusId);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

export interface XY {
  x: number;
  y: number;
}

export function applyConstellationLayout(graph: Graph): void {
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
}

export function computeOrbitLayout(
  graph: Graph,
  focusId: string,
): Map<string, XY> {
  const radii = [0, 180, 320, 460, 600];
  const distances = new Map<string, number>();
  distances.set(focusId, 0);
  const queue: string[] = [focusId];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = distances.get(cur)!;
    if (d >= radii.length - 1) continue;
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
  const byDist = new Map<number, string[]>();
  graph.forEachNode((id) => {
    const d = distances.get(id);
    const key = d === undefined ? radii.length : d;
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
    const r = d <= radii.length - 1 ? radii[d]! : 700;
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

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

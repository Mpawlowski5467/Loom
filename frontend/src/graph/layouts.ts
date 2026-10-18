import type Graph from "graphology";
import forceAtlas2, {
  type ForceAtlas2Settings,
} from "graphology-layout-forceatlas2";
import { resolveOverlaps } from "./overlap";
import { measureLayoutFrame, placeNewNodes } from "./placement";
import { relaxNewNodes } from "./localRelax";

export type { XY, OrbitScene } from "./orbitScenes";
export {
  ORBIT_SCENES,
  ORBIT_SCENE_LABELS,
  computeOrbitScene,
  computeOrbitLayout,
} from "./orbitScenes";
import type { XY } from "./orbitScenes";

/** Full ForceAtlas2 pass for a fresh graph (no prior layout to preserve). */
const FULL_ITERATIONS = 220;
/** Above this many nodes FA2 switches to Barnes-Hut approximation so the
 * synchronous layout pass stays affordable on the main thread. */
const BARNES_HUT_THRESHOLD = 250;

export function applyConstellationLayout(
  graph: Graph,
  /**
   * Known positions to reuse (e.g. from a prior build or dragged nodes).
   * Seeded nodes keep their place exactly. Nodes missing from the seed are
   * placed beside their seeded neighbors and settled locally; ForceAtlas2
   * only runs when nothing is seeded.
   */
  seed?: Map<string, XY>,
): Map<string, XY> {
  const seeded = new Map<string, XY>();
  const fresh: string[] = [];
  graph.forEachNode((id) => {
    const known = seed?.get(id);
    if (!known) {
      fresh.push(id);
      return;
    }
    graph.setNodeAttribute(id, "x", known.x);
    graph.setNodeAttribute(id, "y", known.y);
    seeded.set(id, { x: known.x, y: known.y });
  });

  // A fresh graph gets the spiral + full FA2 run. A fully seeded one (only
  // content changed) is returned verbatim, and a partly seeded one only
  // moves its new nodes.
  if (seeded.size === 0) {
    layoutFromScratch(graph, fresh);
  } else if (fresh.length > 0) {
    settleNewNodes(graph, fresh, seeded);
  }

  const positions = new Map<string, XY>();
  graph.forEachNode((id, attrs) => {
    positions.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
  });
  return positions;
}

function layoutFromScratch(graph: Graph, ids: string[]): void {
  // Golden-angle spiral slots give FA2 a deterministic starting point.
  const phi = Math.PI * (3 - Math.sqrt(5));
  ids.forEach((id, i) => {
    const r = Math.sqrt(i + 1) * 50;
    const a = i * phi;
    graph.setNodeAttribute(id, "x", Math.cos(a) * r);
    graph.setNodeAttribute(id, "y", Math.sin(a) * r);
  });
  forceAtlas2.assign(graph, {
    iterations: FULL_ITERATIONS,
    settings: constellationFA2Settings(graph),
  });
  // FA2 has no collision term; relax any disks it left stacked.
  resolveOverlaps(graph);
}

/** The constellation's ForceAtlas2 forces. The worker batch settle uses them
 * too, so a settled batch lands at the same scale as the fresh layout. */
export function constellationFA2Settings(graph: Graph): ForceAtlas2Settings {
  return {
    ...forceAtlas2.inferSettings(graph),
    gravity: 0.6,
    scalingRatio: 8,
    slowDown: 8,
    // Hubs push their satellites outward instead of swallowing them —
    // spreads the inevitable hairball around well-linked notes.
    outboundAttractionDistribution: true,
    barnesHutOptimize: graph.order > BARNES_HUT_THRESHOLD,
  };
}

/** Place unseeded nodes beside their seeded neighbors, then settle only
 * them. Seeded positions are never written. */
function settleNewNodes(
  graph: Graph,
  fresh: string[],
  seeded: Map<string, XY>,
): void {
  const neighborsOf = (id: string): string[] => graph.neighbors(id);
  const frame = measureLayoutFrame(seeded.values());
  const placed = placeNewNodes(fresh, neighborsOf, seeded, { frame });
  relaxNewNodes(placed, neighborsOf, seeded, { frame });
  for (const [id, p] of placed) {
    graph.setNodeAttribute(id, "x", p.x);
    graph.setNodeAttribute(id, "y", p.y);
  }
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

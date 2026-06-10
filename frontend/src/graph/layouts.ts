import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { resolveOverlaps } from "./overlap";

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
/** Light settling pass when most nodes are seeded from a cached layout —
 * enough to fold a handful of new nodes in without reshuffling the rest. */
const RESEED_ITERATIONS = 60;
/** Above this many nodes FA2 switches to Barnes-Hut approximation so the
 * synchronous layout pass stays affordable on the main thread. */
const BARNES_HUT_THRESHOLD = 250;

export function applyConstellationLayout(
  graph: Graph,
  /**
   * Known positions to reuse (e.g. from a prior build or dragged nodes). Seeded
   * nodes keep their place; only nodes missing from the seed get a fresh spiral
   * slot, and the FA2 pass is shortened so the existing layout barely moves.
   */
  seed?: Map<string, XY>,
): Map<string, XY> {
  const phi = Math.PI * (3 - Math.sqrt(5));
  let i = 0;
  let newNodes = 0;
  graph.forEachNode((id) => {
    const known = seed?.get(id);
    if (known) {
      graph.setNodeAttribute(id, "x", known.x);
      graph.setNodeAttribute(id, "y", known.y);
    } else {
      // golden-angle spiral slot for deterministic placement of new nodes
      const r = Math.sqrt(i + 1) * 50;
      const a = i * phi;
      graph.setNodeAttribute(id, "x", Math.cos(a) * r);
      graph.setNodeAttribute(id, "y", Math.sin(a) * r);
      newNodes++;
    }
    i++;
  });

  // A fully-seeded graph (only content changed) needs no FA2 at all; a partially
  // seeded one gets a short settling pass; a fresh graph gets the full run.
  const hasSeed = seed && seed.size > 0;
  const iterations = !hasSeed
    ? FULL_ITERATIONS
    : newNodes === 0
      ? 0
      : RESEED_ITERATIONS;

  if (iterations > 0) {
    forceAtlas2.assign(graph, {
      iterations,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        gravity: 0.6,
        scalingRatio: 8,
        slowDown: 8,
        // Hubs push their satellites outward instead of swallowing them —
        // spreads the inevitable hairball around well-linked notes.
        outboundAttractionDistribution: true,
        barnesHutOptimize: graph.order > BARNES_HUT_THRESHOLD,
      },
    });
    // FA2 has no collision term; relax any disks it left stacked. Skipped on
    // fully-seeded builds, which must return their seed positions verbatim.
    resolveOverlaps(graph);
  }

  const positions = new Map<string, XY>();
  graph.forEachNode((id, attrs) => {
    positions.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
  });
  return positions;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

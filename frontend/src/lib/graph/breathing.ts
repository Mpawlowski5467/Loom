/**
 * Ambient life: subtle breathing animation for nodes.
 * Nodes gently oscillate size by ~5% on a slow 3-5s cycle, staggered per node.
 * Respects prefers-reduced-motion. Throttled to ~20fps to avoid thrashing.
 */

import type Graph from "graphology";
import type Sigma from "sigma";

const BREATH_AMPLITUDE = 0.05; // 5% size variation
const BREATH_MIN_PERIOD = 3000; // ms
const BREATH_MAX_PERIOD = 5000; // ms
const FRAME_INTERVAL = 50; // ms (~20fps — enough for subtle breathing)

/** Check if user prefers reduced motion. */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Start the breathing animation loop. Returns a stop function.
 */
export function startBreathing(
  graph: Graph,
  sigma: Sigma,
): () => void {
  if (prefersReducedMotion()) {
    return () => {};
  }

  // Store base sizes and assign random phase offsets per node
  const nodePhases = new Map<string, { baseSize: number; period: number; offset: number }>();

  graph.forEachNode((node, attrs) => {
    const baseSize = attrs.size as number;
    graph.setNodeAttribute(node, "baseSize", baseSize);
    nodePhases.set(node, {
      baseSize,
      period: BREATH_MIN_PERIOD + Math.random() * (BREATH_MAX_PERIOD - BREATH_MIN_PERIOD),
      offset: Math.random() * Math.PI * 2,
    });
  });

  // Use setInterval instead of rAF to avoid thrashing at 60fps
  const intervalId = setInterval(() => {
    const now = performance.now();

    graph.forEachNode((node) => {
      const info = nodePhases.get(node);
      if (!info) return;
      if (graph.getNodeAttribute(node, "hidden")) return;

      const phase = (now / info.period) * Math.PI * 2 + info.offset;
      const scale = 1 + Math.sin(phase) * BREATH_AMPLITUDE;
      graph.setNodeAttribute(node, "size", info.baseSize * scale);
    });

    sigma.scheduleRefresh();
  }, FRAME_INTERVAL);

  return () => {
    clearInterval(intervalId);

    // Restore base sizes
    graph.forEachNode((node) => {
      const info = nodePhases.get(node);
      if (info) {
        graph.setNodeAttribute(node, "size", info.baseSize);
      }
    });
  };
}

/**
 * Update breathing data when nodes are added/updated.
 */
export function updateBreathingNode(
  graph: Graph,
  nodeId: string,
): void {
  const baseSize = graph.getNodeAttribute(nodeId, "size") as number;
  graph.setNodeAttribute(nodeId, "baseSize", baseSize);
}

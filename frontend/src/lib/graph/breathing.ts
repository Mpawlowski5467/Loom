/**
 * Ambient life: subtle breathing animation for nodes.
 * Nodes gently oscillate size by ~5% on a slow 3-5s cycle, staggered per node.
 * Respects prefers-reduced-motion.
 */

import type Graph from "graphology";
import type Sigma from "sigma";

const BREATH_AMPLITUDE = 0.05; // 5% size variation
const BREATH_MIN_PERIOD = 3000; // ms
const BREATH_MAX_PERIOD = 5000; // ms

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
    return () => {}; // no-op
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

  let rafId: number;
  let running = true;

  function tick() {
    if (!running) return;
    const now = performance.now();

    graph.forEachNode((node) => {
      const info = nodePhases.get(node);
      if (!info) return;

      // Don't animate hidden nodes
      if (graph.getNodeAttribute(node, "hidden")) return;

      const phase = (now / info.period) * Math.PI * 2 + info.offset;
      const scale = 1 + Math.sin(phase) * BREATH_AMPLITUDE;
      graph.setNodeAttribute(node, "size", info.baseSize * scale);
    });

    sigma.scheduleRefresh();
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);

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

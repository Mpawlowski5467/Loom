/**
 * ForceAtlas2 layout management: configuration, convergence detection,
 * restart on new nodes, and smart initial positioning.
 */

import type Graph from "graphology";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";

/** Tuned FA2 settings — low gravity, linLog for cluster separation. */
export const FA2_SETTINGS = {
  gravity: 1.5,
  scalingRatio: 8,
  slowDown: 10,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  strongGravityMode: false,
  linLogMode: true,
  adjustSizes: true,
} as const;

/** How often we check for convergence (ms). */
const CONVERGENCE_CHECK_MS = 300;

/** Average displacement below this → layout has converged. */
const CONVERGENCE_THRESHOLD = 0.5;

/** Absolute max runtime even if not converged. */
const MAX_LAYOUT_MS = 8000;

/**
 * Start FA2, stop when converged or after MAX_LAYOUT_MS.
 * Returns the supervisor (caller should keep a ref for cleanup).
 */
export function startLayout(graph: Graph): FA2LayoutSupervisor {
  const supervisor = new FA2LayoutSupervisor(graph, {
    settings: FA2_SETTINGS,
  });
  supervisor.start();

  let elapsed = 0;
  const checkInterval = setInterval(() => {
    elapsed += CONVERGENCE_CHECK_MS;

    if (!supervisor.isRunning()) {
      clearInterval(checkInterval);
      return;
    }

    // Check convergence: sample average displacement
    const converged = checkConvergence(graph);
    if (converged || elapsed >= MAX_LAYOUT_MS) {
      supervisor.stop();
      clearInterval(checkInterval);
    }
  }, CONVERGENCE_CHECK_MS);

  // Store interval ID on supervisor for cleanup
  (supervisor as unknown as Record<string, unknown>).__convergenceInterval =
    checkInterval;

  return supervisor;
}

/**
 * Kill a supervisor and clean up its convergence timer.
 */
export function killLayout(supervisor: FA2LayoutSupervisor | null): void {
  if (!supervisor) return;
  const interval = (
    supervisor as unknown as Record<string, unknown>
  ).__convergenceInterval;
  if (interval) clearInterval(interval as number);
  supervisor.kill();
}

/**
 * Restart layout (e.g. when new nodes arrive). Stops existing, starts fresh.
 */
export function restartLayout(
  graph: Graph,
  existingSupervisor: FA2LayoutSupervisor | null,
): FA2LayoutSupervisor {
  killLayout(existingSupervisor);
  return startLayout(graph);
}

/**
 * Check if the layout has converged by sampling node displacement.
 * We store previous positions and compare.
 */
const prevPositions = new Map<string, { x: number; y: number }>();

function checkConvergence(graph: Graph): boolean {
  let totalDisplacement = 0;
  let count = 0;

  graph.forEachNode((node) => {
    const x = graph.getNodeAttribute(node, "x") as number;
    const y = graph.getNodeAttribute(node, "y") as number;
    const prev = prevPositions.get(node);

    if (prev) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      totalDisplacement += Math.sqrt(dx * dx + dy * dy);
    }

    prevPositions.set(node, { x, y });
    count++;
  });

  if (count === 0) return true;
  return totalDisplacement / count < CONVERGENCE_THRESHOLD;
}

/**
 * Position a new node near its neighbors instead of randomly.
 */
export function positionNearNeighbors(
  graph: Graph,
  nodeId: string,
): void {
  const neighbors = graph.neighbors(nodeId);
  if (neighbors.length === 0) {
    // No neighbors: place near center with slight jitter
    let cx = 0;
    let cy = 0;
    let n = 0;
    graph.forEachNode((_, attrs) => {
      cx += attrs.x as number;
      cy += attrs.y as number;
      n++;
    });
    if (n > 1) {
      // n > 1 because the node itself is already in the graph
      cx /= n;
      cy /= n;
    }
    graph.setNodeAttribute(nodeId, "x", cx + (Math.random() - 0.5) * 30);
    graph.setNodeAttribute(nodeId, "y", cy + (Math.random() - 0.5) * 30);
    return;
  }

  // Average neighbor positions + jitter
  let sx = 0;
  let sy = 0;
  for (const nid of neighbors) {
    sx += graph.getNodeAttribute(nid, "x") as number;
    sy += graph.getNodeAttribute(nid, "y") as number;
  }
  sx /= neighbors.length;
  sy /= neighbors.length;

  graph.setNodeAttribute(nodeId, "x", sx + (Math.random() - 0.5) * 20);
  graph.setNodeAttribute(nodeId, "y", sy + (Math.random() - 0.5) * 20);
}

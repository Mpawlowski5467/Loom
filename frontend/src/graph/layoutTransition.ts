import type Graph from "graphology";
import type Sigma from "sigma";
import { easeInOutCubic, type XY } from "./layouts";
import type { FrameLoop } from "./frameLoop";

interface TweenOptions {
  sigma: Sigma;
  graph: Graph;
  targets: Map<string, XY>;
  frameLoop: FrameLoop;
  duration?: number;
  /** Re-fit the camera after the tween ends. */
  onComplete?: () => void;
}

export interface TweenHandle {
  cancel: () => void;
}

/**
 * Animate every node from its current position to ``targets[id]`` using cubic
 * ease over ``duration`` ms, driven by the shared frame loop. Returns a handle
 * whose ``cancel`` unregisters the in-flight tick — wire it into effect
 * cleanup and into the drag handler (grabbing a node aborts a scene tween).
 */
export function startLayoutTween(opts: TweenOptions): TweenHandle {
  const { sigma, graph, targets, frameLoop, duration = 700, onComplete } = opts;
  const starts = new Map<string, XY>();
  for (const id of targets.keys()) {
    if (!graph.hasNode(id)) continue;
    starts.set(id, {
      x: graph.getNodeAttribute(id, "x") as number,
      y: graph.getNodeAttribute(id, "y") as number,
    });
  }
  const t0 = performance.now();
  let remove: (() => void) | null = null;

  const tick = (now: number): boolean => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = easeInOutCubic(p);
    for (const [id, s] of starts) {
      const tgt = targets.get(id)!;
      graph.setNodeAttribute(id, "x", s.x + (tgt.x - s.x) * eased);
      graph.setNodeAttribute(id, "y", s.y + (tgt.y - s.y) * eased);
    }
    if (p >= 1) {
      remove?.();
      remove = null;
      sigma.refresh(); // full re-index once positions have settled
      onComplete?.();
      return false; // already refreshed; don't double up this frame
    }
    // Position attribute events already schedule Sigma; do not ask the shared
    // frame loop for a redundant unqualified full refresh.
    return false;
  };

  remove = frameLoop.add(tick);
  return {
    cancel: () => {
      remove?.();
      remove = null;
    },
  };
}

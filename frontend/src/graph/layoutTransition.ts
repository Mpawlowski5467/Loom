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
  graph.forEachNode((id, attrs) => {
    starts.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
  });
  const t0 = performance.now();
  let remove: (() => void) | null = null;

  const tick = (now: number): boolean => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = easeInOutCubic(p);
    graph.forEachNode((id) => {
      const s = starts.get(id);
      const tgt = targets.get(id);
      if (!s || !tgt) return;
      graph.setNodeAttribute(id, "x", s.x + (tgt.x - s.x) * eased);
      graph.setNodeAttribute(id, "y", s.y + (tgt.y - s.y) * eased);
    });
    if (p >= 1) {
      remove?.();
      remove = null;
      sigma.refresh(); // full re-index once positions have settled
      onComplete?.();
      return false; // already refreshed; don't double up this frame
    }
    return true;
  };

  remove = frameLoop.add(tick);
  return {
    cancel: () => {
      remove?.();
      remove = null;
    },
  };
}

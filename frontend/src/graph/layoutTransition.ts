import type Graph from "graphology";
import type Sigma from "sigma";
import { easeInOutCubic, type XY } from "./layouts";

interface TweenOptions {
  sigma: Sigma;
  graph: Graph;
  targets: Map<string, XY>;
  duration?: number;
  /** Re-fit the camera after the tween ends. */
  onComplete?: () => void;
}

interface TweenHandle {
  cancel: () => void;
}

/**
 * Animate every node from its current position to ``targets[id]`` using
 * cubic ease over ``duration`` ms. Returns a handle whose ``cancel`` aborts
 * the in-flight rAF chain — wire it into the effect cleanup.
 */
export function startLayoutTween(opts: TweenOptions): TweenHandle {
  const { sigma, graph, targets, duration = 700, onComplete } = opts;
  const starts = new Map<string, XY>();
  graph.forEachNode((id, attrs) => {
    starts.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
  });
  const t0 = performance.now();
  let raf = 0;
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / duration);
    const eased = easeInOutCubic(p);
    graph.forEachNode((id) => {
      const s = starts.get(id);
      const tgt = targets.get(id);
      if (!s || !tgt) return;
      graph.setNodeAttribute(id, "x", s.x + (tgt.x - s.x) * eased);
      graph.setNodeAttribute(id, "y", s.y + (tgt.y - s.y) * eased);
    });
    sigma.refresh({ skipIndexation: true });
    if (p < 1) {
      raf = requestAnimationFrame(step);
    } else {
      sigma.refresh();
      onComplete?.();
    }
  };
  raf = requestAnimationFrame(step);
  return {
    cancel: () => cancelAnimationFrame(raf),
  };
}

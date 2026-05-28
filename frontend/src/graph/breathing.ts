import type Graph from "graphology";
import type Sigma from "sigma";

function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}

export interface ScaleRef {
  current: number;
}

// Throttle the breathing pulse to ~30fps. The animation is a ±6% size pulse
// at 0.6Hz — visually indistinguishable from 60fps, half the work.
const FRAME_INTERVAL_MS = 33;

export function startBreathing(
  sigma: Sigma,
  graph: Graph,
  baseSizes: Map<string, number>,
  scaleRef: ScaleRef,
): () => void {
  let raf = 0;
  let stopped = false;
  const start = performance.now();
  let lastFrame = 0;

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    if (now - lastFrame < FRAME_INTERVAL_MS) {
      raf = requestAnimationFrame(tick);
      return;
    }
    lastFrame = now;
    const t = (now - start) / 1000;
    const scale = scaleRef.current;
    graph.forEachNode((id) => {
      const base = (baseSizes.get(id) ?? 4) * scale;
      const breathe = 1 + 0.06 * Math.sin(t * 0.6 + phaseOf(id));
      graph.setNodeAttribute(id, "size", base * breathe);
    });
    sigma.refresh({ skipIndexation: true });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

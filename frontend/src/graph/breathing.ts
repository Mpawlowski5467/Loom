import type Graph from "graphology";
import type { FrameTick } from "./frameLoop";
import type { GraphTuning } from "./tuning";

function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}

// Throttle the breathing pulse to ~30fps. The animation is a ±6% size pulse
// at 0.6Hz — visually indistinguishable from 60fps, half the work.
const FRAME_INTERVAL_MS = 33;

/**
 * A frame-loop tick that gently pulses every node's size ±6%. Reads the live
 * ``sizeScale`` from tuning so the node-size slider stays responsive. Graph
 * attribute events already schedule Sigma's render, so this tick returns false
 * after mutations rather than asking the frame loop for a second full refresh.
 */
export function createBreathingTick(
  graph: Graph,
  baseSizes: Map<string, number>,
  tuning: GraphTuning,
): FrameTick {
  const start = performance.now();
  let lastFrame = 0;
  return (now) => {
    if (tuning.dragging) return false;
    if (now - lastFrame < FRAME_INTERVAL_MS) return false;
    lastFrame = now;
    const t = (now - start) / 1000;
    const scale = tuning.sizeScale;
    graph.forEachNode((id, attrs) => {
      if (attrs["hidden"]) return;
      const base = (baseSizes.get(id) ?? 4) * scale;
      const breathe = 1 + 0.06 * Math.sin(t * 0.6 + phaseOf(id));
      graph.setNodeAttribute(id, "size", base * breathe);
    });
    return false;
  };
}

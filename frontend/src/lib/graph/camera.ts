/**
 * Camera utilities: zoom-to-fit, animate-to-node, smooth easing.
 */

import type Graph from "graphology";
import type Sigma from "sigma";

const ANIMATION_DURATION = 500;

/** Ease-out cubic for smooth camera transitions. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate the camera from its current state to a target state.
 */
export function animateCamera(
  sigma: Sigma,
  target: { x: number; y: number; ratio: number },
  duration = ANIMATION_DURATION,
): void {
  const camera = sigma.getCamera();
  const start = { x: camera.x, y: camera.y, ratio: camera.ratio };
  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const e = easeOutCubic(t);

    camera.setState({
      x: start.x + (target.x - start.x) * e,
      y: start.y + (target.y - start.y) * e,
      ratio: start.ratio + (target.ratio - start.ratio) * e,
      angle: 0,
    });

    if (t < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

/**
 * Zoom camera to fit all visible nodes with padding.
 */
export function zoomToFit(
  sigma: Sigma,
  graph: Graph,
  animated = true,
): void {
  if (graph.order === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  graph.forEachNode((_, attrs) => {
    if (attrs.hidden) return;
    const x = attrs.x as number;
    const y = attrs.y as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  if (!isFinite(minX)) return;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Compute ratio to fit graph in viewport with padding
  const graphWidth = maxX - minX || 1;
  const graphHeight = maxY - minY || 1;
  const { width, height } = sigma.getDimensions();
  const padding = 1.2; // 20% padding
  const ratio = Math.max(
    (graphWidth * padding) / width,
    (graphHeight * padding) / height,
  );

  const target = { x: cx, y: cy, ratio: Math.max(ratio, 0.1) };

  if (animated) {
    animateCamera(sigma, target, 800);
  } else {
    sigma.getCamera().setState({ ...target, angle: 0 });
  }
}

/**
 * Animate camera to center on a specific node.
 */
export function animateToNode(
  sigma: Sigma,
  graph: Graph,
  nodeId: string,
): void {
  if (!graph.hasNode(nodeId)) return;

  const attrs = graph.getNodeAttributes(nodeId);
  const target = {
    x: attrs.x as number,
    y: attrs.y as number,
    ratio: sigma.getCamera().ratio,
  };

  animateCamera(sigma, target);
}

import type Graph from "graphology";
import type Sigma from "sigma";
import type { ViewportNodePoint } from "@/graph/keyboardNavigation";

/** Every visible node's position on screen, for arrow-key navigation. */
export function visibleViewportPoints(
  sigma: Sigma,
  graph: Graph,
): ViewportNodePoint[] {
  const points: ViewportNodePoint[] = [];
  graph.forEachNode((id, attributes) => {
    if (attributes["hidden"]) return;
    const point = sigma.graphToViewport({
      x: Number(attributes["x"]),
      y: Number(attributes["y"]),
    });
    if (Number.isFinite(point.x) && Number.isFinite(point.y))
      points.push({ id, x: point.x, y: point.y });
  });
  return points;
}

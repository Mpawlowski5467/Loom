import type Graph from "graphology";
import type Sigma from "sigma";

function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}

export function startBreathing(
  sigma: Sigma,
  graph: Graph,
  baseSizes: Map<string, number>,
): () => void {
  let raf = 0;
  let stopped = false;
  const start = performance.now();

  const tick = () => {
    if (stopped) return;
    const t = (performance.now() - start) / 1000;
    graph.forEachNode((id) => {
      const base = baseSizes.get(id) ?? 4;
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

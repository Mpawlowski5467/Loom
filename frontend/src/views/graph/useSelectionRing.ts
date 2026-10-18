import { useEffect, type RefObject } from "react";
import type Sigma from "sigma";

/**
 * Keep an absolutely positioned ring element on the selected node: Sigma's
 * node program has no border, so the ring is a DOM overlay that follows the
 * camera and node size on every render.
 */
export function useSelectionRing(
  sigmaRef: RefObject<Sigma | null>,
  ringRef: RefObject<HTMLDivElement | null>,
  selectedId: string | null,
  sigmaReady: number,
): void {
  useEffect(() => {
    const sigma = sigmaRef.current;
    const ring = ringRef.current;
    if (!sigma || !ring) return;
    const place = () => {
      const data = selectedId
        ? sigma.getNodeDisplayData(selectedId)
        : undefined;
      if (!data || data.hidden) {
        ring.style.display = "none";
        return;
      }
      const { x, y } = sigma.framedGraphToViewport(data);
      const r = sigma.scaleSize(data.size) + 5;
      ring.style.display = "block";
      ring.style.width = ring.style.height = `${r * 2}px`;
      ring.style.transform = `translate(${x - r}px, ${y - r}px)`;
    };
    place();
    sigma.on("afterRender", place);
    return () => {
      sigma.off("afterRender", place);
      ring.style.display = "none";
    };
  }, [sigmaRef, ringRef, selectedId, sigmaReady]);
}

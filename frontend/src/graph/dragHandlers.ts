import type Graph from "graphology";
import type Sigma from "sigma";
import { easeInOutCubic, type XY } from "./layouts";

interface AttachDragArgs {
  sigma: Sigma;
  graph: Graph;
  getSnapTarget: (id: string) => XY | undefined;
  hoveredRef: { current: string | null };
  tweenRafRef: { current: number };
  isDragging: { current: boolean };
  justDragged: { current: boolean };
}

const SNAP_DURATION_MS = 350;

export function attachDrag(args: AttachDragArgs): () => void {
  const {
    sigma,
    graph,
    getSnapTarget,
    hoveredRef,
    tweenRafRef,
    isDragging,
    justDragged,
  } = args;

  let draggedNode: string | null = null;
  let movedDuringPress = false;
  const snapRafs = new Map<string, number>();

  const cancelSnap = (id: string) => {
    const raf = snapRafs.get(id);
    if (raf) {
      cancelAnimationFrame(raf);
      snapRafs.delete(id);
    }
  };

  const snapHome = (id: string) => {
    const target = getSnapTarget(id);
    if (!target) return;
    const startX = graph.getNodeAttribute(id, "x") as number;
    const startY = graph.getNodeAttribute(id, "y") as number;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / SNAP_DURATION_MS);
      const eased = easeInOutCubic(p);
      graph.setNodeAttribute(id, "x", startX + (target.x - startX) * eased);
      graph.setNodeAttribute(id, "y", startY + (target.y - startY) * eased);
      sigma.refresh({ skipIndexation: true });
      if (p < 1) {
        snapRafs.set(id, requestAnimationFrame(step));
      } else {
        snapRafs.delete(id);
      }
    };
    cancelSnap(id);
    snapRafs.set(id, requestAnimationFrame(step));
  };

  const onDownNode = (payload: {
    node: string;
    event: { preventSigmaDefault?: () => void };
  }) => {
    const { node, event } = payload;
    if (graph.getNodeAttribute(node, "hidden")) return;
    cancelAnimationFrame(tweenRafRef.current);
    cancelSnap(node);
    draggedNode = node;
    movedDuringPress = false;
    isDragging.current = true;
    hoveredRef.current = null;
    sigma.getCamera().disable();
    event.preventSigmaDefault?.();
  };

  const onMoveBody = (payload: {
    event: {
      x: number;
      y: number;
      preventSigmaDefault?: () => void;
      original: Event;
    };
  }) => {
    if (!isDragging.current || !draggedNode) return;
    const { event } = payload;
    const pos = sigma.viewportToGraph({ x: event.x, y: event.y });
    graph.setNodeAttribute(draggedNode, "x", pos.x);
    graph.setNodeAttribute(draggedNode, "y", pos.y);
    movedDuringPress = true;
    event.preventSigmaDefault?.();
    event.original.preventDefault();
    event.original.stopPropagation();
  };

  const endDrag = () => {
    if (!draggedNode || !isDragging.current) return;
    const node = draggedNode;
    const wasDrag = movedDuringPress;
    isDragging.current = false;
    draggedNode = null;
    movedDuringPress = false;
    sigma.getCamera().enable();
    if (wasDrag) {
      justDragged.current = true;
      // clear after the click handler has had a chance to see it
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      snapHome(node);
    }
  };

  // Sigma emits `upNode` / `upStage` / `upEdge` for mouseup over each target.
  // Cover all three plus a window-level fallback in case release is outside.
  const onWindowMouseUp = () => endDrag();

  sigma.on("downNode", onDownNode);
  sigma.on("moveBody", onMoveBody);
  sigma.on("upNode", endDrag);
  sigma.on("upStage", endDrag);
  sigma.on("upEdge", endDrag);
  window.addEventListener("mouseup", onWindowMouseUp);

  return () => {
    for (const raf of snapRafs.values()) cancelAnimationFrame(raf);
    snapRafs.clear();
    sigma.off("downNode", onDownNode);
    sigma.off("moveBody", onMoveBody);
    sigma.off("upNode", endDrag);
    sigma.off("upStage", endDrag);
    sigma.off("upEdge", endDrag);
    window.removeEventListener("mouseup", onWindowMouseUp);
  };
}

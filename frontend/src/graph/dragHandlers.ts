import type Graph from "graphology";
import type Sigma from "sigma";
import type { XY } from "./layouts";
import { startDragSim, type DragSim } from "./physics";

interface AttachDragArgs {
  sigma: Sigma;
  graph: Graph;
  getSnapTarget: (id: string) => XY | undefined;
  hoveredRef: { current: string | null };
  tweenRafRef: { current: number };
  isDragging: { current: boolean };
  justDragged: { current: boolean };
}

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
  let sim: DragSim | null = null;
  let lastGraphX = 0;
  let lastGraphY = 0;
  let prevGraphX = 0;
  let prevGraphY = 0;

  const stopSim = () => {
    if (sim) {
      sim.stop();
      sim = null;
    }
  };

  const onDownNode = (payload: {
    node: string;
    event: { preventSigmaDefault?: () => void };
  }) => {
    const { node, event } = payload;
    if (graph.getNodeAttribute(node, "hidden")) return;
    cancelAnimationFrame(tweenRafRef.current);
    stopSim();
    draggedNode = node;
    movedDuringPress = false;
    isDragging.current = true;
    hoveredRef.current = null;
    sigma.getCamera().disable();

    const neighborIds: string[] = [];
    const seen = new Set<string>();
    graph.forEachNeighbor(node, (n) => {
      if (seen.has(n)) return;
      if (graph.getNodeAttribute(n, "hidden")) return;
      seen.add(n);
      neighborIds.push(n);
    });

    lastGraphX = graph.getNodeAttribute(node, "x") as number;
    lastGraphY = graph.getNodeAttribute(node, "y") as number;
    prevGraphX = lastGraphX;
    prevGraphY = lastGraphY;

    sim = startDragSim({
      sigma,
      graph,
      draggedId: node,
      neighborIds,
      getHome: getSnapTarget,
    });

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
    if (!isDragging.current || !draggedNode || !sim) return;
    const { event } = payload;
    const pos = sigma.viewportToGraph({ x: event.x, y: event.y });
    prevGraphX = lastGraphX;
    prevGraphY = lastGraphY;
    lastGraphX = pos.x;
    lastGraphY = pos.y;
    sim.setDraggedPos(pos.x, pos.y);
    movedDuringPress = true;
    event.preventSigmaDefault?.();
    event.original.preventDefault();
    event.original.stopPropagation();
  };

  const endDrag = () => {
    if (!draggedNode || !isDragging.current) return;
    const wasDrag = movedDuringPress;
    isDragging.current = false;
    draggedNode = null;
    movedDuringPress = false;
    sigma.getCamera().enable();
    if (wasDrag && sim) {
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      const vx = lastGraphX - prevGraphX;
      const vy = lastGraphY - prevGraphY;
      sim.release(vx, vy);
      sim = null;
    } else {
      stopSim();
    }
  };

  const onWindowMouseUp = () => endDrag();

  sigma.on("downNode", onDownNode);
  sigma.on("moveBody", onMoveBody);
  sigma.on("upNode", endDrag);
  sigma.on("upStage", endDrag);
  sigma.on("upEdge", endDrag);
  window.addEventListener("mouseup", onWindowMouseUp);

  return () => {
    stopSim();
    sigma.off("downNode", onDownNode);
    sigma.off("moveBody", onMoveBody);
    sigma.off("upNode", endDrag);
    sigma.off("upStage", endDrag);
    sigma.off("upEdge", endDrag);
    window.removeEventListener("mouseup", onWindowMouseUp);
  };
}

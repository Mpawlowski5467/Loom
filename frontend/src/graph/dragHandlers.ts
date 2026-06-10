import type Graph from "graphology";
import type Sigma from "sigma";
import type { XY } from "./layouts";
import { startDragSim, type DragSim } from "./physics";

interface AttachDragArgs {
  sigma: Sigma;
  graph: Graph;
  getSnapTarget: (id: string) => XY | undefined;
  /** Clear hover state when a drag begins. */
  clearHover: () => void;
  /** Abort any in-flight scene tween — grabbing a node interrupts it. */
  cancelTween: () => void;
  isDragging: { current: boolean };
  justDragged: { current: boolean };
}

export function attachDrag(args: AttachDragArgs): () => void {
  const {
    sigma,
    graph,
    getSnapTarget,
    clearHover,
    cancelTween,
    isDragging,
    justDragged,
  } = args;

  let draggedNode: string | null = null;
  let movedDuringPress = false;
  let sim: DragSim | null = null;
  // A released sim keeps its own rAF chain alive until kinetic energy settles
  // (~0.5–1s). We hold onto it here so teardown can halt that post-release
  // animation — otherwise the loop would keep mutating the graph / refreshing a
  // destroyed Sigma instance after detach. Cleared when the settle completes.
  let settlingSim: DragSim | null = null;
  // Bounds how long we hold the settling-sim reference: physics settles well
  // within this window, so this timer drops the ref after a natural settle even
  // if the user never interacts again (no lingering dead-object reference).
  let settleClearTimer: ReturnType<typeof setTimeout> | null = null;
  let lastGraphX = 0;
  let lastGraphY = 0;
  let prevGraphX = 0;
  let prevGraphY = 0;

  // Max settle window in ms; physics converges before this. Generous so a
  // released sim is never dropped mid-animation, only after it has stopped.
  const SETTLE_CLEAR_MS = 2000;

  const clearSettling = () => {
    if (settleClearTimer !== null) {
      clearTimeout(settleClearTimer);
      settleClearTimer = null;
    }
    if (settlingSim) {
      settlingSim.stop();
      settlingSim = null;
    }
  };

  const stopSim = () => {
    if (sim) {
      sim.stop();
      sim = null;
    }
    clearSettling();
  };

  const onDownNode = (payload: {
    node: string;
    event: { preventSigmaDefault?: () => void };
  }) => {
    const { node, event } = payload;
    if (graph.getNodeAttribute(node, "hidden")) return;
    cancelTween();
    stopSim();
    draggedNode = node;
    movedDuringPress = false;
    isDragging.current = true;
    clearHover();
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
      // A prior settling sim has either already finished or been superseded;
      // halt it before tracking the new one so we never hold more than one.
      clearSettling();
      // The released sim keeps animating until it settles. Track it so detach
      // can stop it, and arm a timer to drop the ref after a natural settle.
      settlingSim = sim;
      sim = null;
      settlingSim.release(vx, vy);
      settleClearTimer = setTimeout(clearSettling, SETTLE_CLEAR_MS);
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

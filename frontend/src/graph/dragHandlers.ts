import type Graph from "graphology";
import type Sigma from "sigma";
import type { XY } from "./layouts";
import type { FrameLoop } from "./frameLoop";
import { startFluidSim, type DragSim, type ReleaseMode } from "./fluidSim";

interface AttachDragArgs {
  sigma: Sigma;
  graph: Graph;
  frameLoop: FrameLoop;
  getSnapTarget: (id: string) => XY | undefined;
  /** Sticky (force layout) vs elastic (orbit scenes) release, read at release. */
  getReleaseMode: () => ReleaseMode;
  /** Sticky settles report final positions here (new homes for later drags). */
  onSettled?: (positions: Map<string, XY>) => void;
  /** Clear hover state when a drag begins. */
  clearHover: () => void;
  /** Abort any in-flight scene tween — grabbing a node interrupts it. */
  cancelTween: () => void;
  /** Receives a handle that halts the active sim; scene staging calls it so
   * a layout switch never leaves a settling sim fighting the tween. */
  stopSimRef?: { current: (() => void) | null };
  isDragging: { current: boolean };
  justDragged: { current: boolean };
}

export function attachDrag(args: AttachDragArgs): () => void {
  const {
    sigma,
    graph,
    frameLoop,
    getSnapTarget,
    getReleaseMode,
    onSettled,
    clearHover,
    cancelTween,
    stopSimRef,
    isDragging,
    justDragged,
  } = args;

  let draggedNode: string | null = null;
  let movedDuringPress = false;
  // The active sim. A released sim keeps settling on the shared frame loop;
  // we hold the handle (stop() is idempotent — a finished sim already
  // unsubscribed its tick) so the next grab or a detach can halt it mid-settle.
  let sim: DragSim | null = null;
  let lastGraphX = 0;
  let lastGraphY = 0;
  let prevGraphX = 0;
  let prevGraphY = 0;

  const stopSim = () => {
    sim?.stop();
    sim = null;
  };
  if (stopSimRef) stopSimRef.current = stopSim;

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

    lastGraphX = graph.getNodeAttribute(node, "x") as number;
    lastGraphY = graph.getNodeAttribute(node, "y") as number;
    prevGraphX = lastGraphX;
    prevGraphY = lastGraphY;

    sim = startFluidSim({
      sigma,
      graph,
      frameLoop,
      draggedId: node,
      getHome: getSnapTarget,
      getReleaseMode,
      onSettled,
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
      // The released sim keeps settling on the frame loop; `sim` stays held
      // so detach (or the next grab) can stop it mid-settle.
      sim.release(lastGraphX - prevGraphX, lastGraphY - prevGraphY);
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
    if (stopSimRef) stopSimRef.current = null;
    sigma.off("downNode", onDownNode);
    sigma.off("moveBody", onMoveBody);
    sigma.off("upNode", endDrag);
    sigma.off("upStage", endDrag);
    sigma.off("upEdge", endDrag);
    window.removeEventListener("mouseup", onWindowMouseUp);
  };
}

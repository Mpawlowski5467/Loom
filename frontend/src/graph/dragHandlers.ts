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
  /** Optional lifecycle signal for pausing expensive decorative animations. */
  onDragStateChange?: (dragging: boolean) => void;
  /** Active from pointer-down through the end of elastic/sticky settling. */
  onSimulationStateChange?: (active: boolean) => void;
}

interface PointerEventLike {
  x?: number;
  y?: number;
  preventSigmaDefault?: () => void;
  original?: Event;
}

const DRAG_THRESHOLD_PX = 3;
const VELOCITY_FRAME_MS = 1000 / 60;
const VELOCITY_BLEND = 0.4;

function eventTime(event: PointerEventLike): number | null {
  const value = event.original?.timeStamp;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
    onDragStateChange,
    onSimulationStateChange,
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
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  let downViewport: XY | null = null;
  let lastSampleAt: number | null = null;
  let smoothVx = 0;
  let smoothVy = 0;
  let hasTimedVelocity = false;
  let justDraggedTimer: ReturnType<typeof setTimeout> | null = null;
  let simulationActive = false;

  const setSimulationState = (next: boolean): void => {
    if (simulationActive === next) return;
    simulationActive = next;
    onSimulationStateChange?.(next);
  };

  const stopSim = () => {
    sim?.stop();
    sim = null;
  };

  const setDragState = (next: boolean): void => {
    if (isDragging.current === next) return;
    isDragging.current = next;
    onDragStateChange?.(next);
  };

  const resetGesture = (): void => {
    const wasActive = draggedNode !== null || isDragging.current;
    draggedNode = null;
    movedDuringPress = false;
    downViewport = null;
    lastSampleAt = null;
    hasTimedVelocity = false;
    if (wasActive) sigma.getCamera().enable();
    setDragState(false);
  };

  // Scene staging, window blur, teardown, and a superseding grab all use the
  // same cancellation path. It restores interaction state as well as stopping
  // physics, and repeated calls are no-ops from the user's perspective.
  const cancelDrag = (): void => {
    stopSim();
    resetGesture();
  };
  if (stopSimRef) stopSimRef.current = cancelDrag;

  const onDownNode = (payload: { node: string; event: PointerEventLike }) => {
    const { node, event } = payload;
    if (graph.getNodeAttribute(node, "hidden")) return;
    event.preventSigmaDefault?.();
    cancelTween();
    cancelDrag();
    draggedNode = node;
    movedDuringPress = false;
    setDragState(true);
    clearHover();
    sigma.getCamera().disable();

    lastGraphX = graph.getNodeAttribute(node, "x") as number;
    lastGraphY = graph.getNodeAttribute(node, "y") as number;
    prevGraphX = lastGraphX;
    prevGraphY = lastGraphY;
    smoothVx = 0;
    smoothVy = 0;
    hasTimedVelocity = false;
    lastSampleAt = eventTime(event);

    if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
      downViewport = { x: event.x!, y: event.y! };
      const pointer = sigma.viewportToGraph(downViewport);
      grabOffsetX = lastGraphX - pointer.x;
      grabOffsetY = lastGraphY - pointer.y;
    } else {
      // Backwards-compatible path for synthetic/older Sigma payloads without
      // down coordinates: the first move behaves exactly as it did before.
      downViewport = null;
      grabOffsetX = 0;
      grabOffsetY = 0;
    }

    let nextSim: DragSim | null = null;
    nextSim = startFluidSim({
      sigma,
      graph,
      frameLoop,
      draggedId: node,
      getHome: getSnapTarget,
      getReleaseMode,
      onSettled,
      onFinished: () => {
        if (sim === nextSim) sim = null;
        setSimulationState(false);
      },
    });
    sim = nextSim;
    setSimulationState(true);
  };

  const onMoveBody = (payload: {
    event: PointerEventLike & { x: number; y: number };
  }) => {
    if (!isDragging.current || !draggedNode || !sim) return;
    const { event } = payload;
    event.preventSigmaDefault?.();
    event.original?.preventDefault();
    event.original?.stopPropagation();

    if (
      !movedDuringPress &&
      downViewport &&
      Math.hypot(event.x - downViewport.x, event.y - downViewport.y) <
        DRAG_THRESHOLD_PX
    ) {
      return;
    }

    const pointer = sigma.viewportToGraph({ x: event.x, y: event.y });
    const pos = {
      x: pointer.x + grabOffsetX,
      y: pointer.y + grabOffsetY,
    };
    prevGraphX = lastGraphX;
    prevGraphY = lastGraphY;
    lastGraphX = pos.x;
    lastGraphY = pos.y;

    const at = eventTime(event);
    if (at !== null && lastSampleAt !== null && at > lastSampleAt) {
      const scale = VELOCITY_FRAME_MS / (at - lastSampleAt);
      const sampleVx = (lastGraphX - prevGraphX) * scale;
      const sampleVy = (lastGraphY - prevGraphY) * scale;
      if (hasTimedVelocity) {
        smoothVx += (sampleVx - smoothVx) * VELOCITY_BLEND;
        smoothVy += (sampleVy - smoothVy) * VELOCITY_BLEND;
      } else {
        smoothVx = sampleVx;
        smoothVy = sampleVy;
        hasTimedVelocity = true;
      }
    } else {
      // Missing/non-monotonic timestamps retain the legacy last-delta release.
      hasTimedVelocity = false;
    }
    lastSampleAt = at;

    sim.setDraggedPos(pos.x, pos.y);
    movedDuringPress = true;
  };

  const endDrag = () => {
    if (!draggedNode || !isDragging.current) return;
    const wasDrag = movedDuringPress;
    const activeSim = sim;
    draggedNode = null;
    movedDuringPress = false;
    downViewport = null;
    lastSampleAt = null;
    setDragState(false);
    sigma.getCamera().enable();
    if (wasDrag && activeSim) {
      justDragged.current = true;
      if (justDraggedTimer !== null) clearTimeout(justDraggedTimer);
      justDraggedTimer = setTimeout(() => {
        justDragged.current = false;
        justDraggedTimer = null;
      }, 0);
      // The released sim keeps settling on the frame loop; `sim` stays held
      // so detach (or the next grab) can stop it mid-settle.
      activeSim.release(
        hasTimedVelocity ? smoothVx : lastGraphX - prevGraphX,
        hasTimedVelocity ? smoothVy : lastGraphY - prevGraphY,
      );
    } else {
      stopSim();
    }
    hasTimedVelocity = false;
  };

  const onWindowMouseUp = () => endDrag();
  const onWindowBlur = () => cancelDrag();

  sigma.on("downNode", onDownNode);
  sigma.on("moveBody", onMoveBody);
  sigma.on("upNode", endDrag);
  sigma.on("upStage", endDrag);
  sigma.on("upEdge", endDrag);
  window.addEventListener("mouseup", onWindowMouseUp);
  window.addEventListener("blur", onWindowBlur);

  return () => {
    cancelDrag();
    if (justDraggedTimer !== null) clearTimeout(justDraggedTimer);
    justDraggedTimer = null;
    justDragged.current = false;
    if (stopSimRef?.current === cancelDrag) stopSimRef.current = null;
    sigma.off("downNode", onDownNode);
    sigma.off("moveBody", onMoveBody);
    sigma.off("upNode", endDrag);
    sigma.off("upStage", endDrag);
    sigma.off("upEdge", endDrag);
    window.removeEventListener("mouseup", onWindowMouseUp);
    window.removeEventListener("blur", onWindowBlur);
  };
}

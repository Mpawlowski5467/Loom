import type Graph from "graphology";
import type Sigma from "sigma";
import type { XY } from "./layouts";

const SPRING_K = 0.08;
const NEIGHBOR_PULL = 0.18;
const DAMPING = 0.82;
const STOP_KE = 0.05;
const MAX_OFFSET = 60;
// 30fps cap on the spring sim — matches the breathing loop's cadence so the
// two refreshes never stack inside one paint, and the spring math runs at
// half the cost. Visually identical to 60fps for sub-pixel velocities.
const FRAME_INTERVAL_MS = 33;

interface DragSimArgs {
  sigma: Sigma;
  graph: Graph;
  draggedId: string;
  neighborIds: string[];
  getHome: (id: string) => XY | undefined;
}

interface NeighborState {
  id: string;
  home: XY;
  startX: number;
  startY: number;
  vx: number;
  vy: number;
}

export interface DragSim {
  setDraggedPos: (x: number, y: number) => void;
  release: (vx: number, vy: number) => void;
  stop: () => void;
}

/**
 * Soft-spring simulation for graph drag interactions.
 *
 * While the user drags, the dragged node tracks the cursor and its direct
 * neighbors are pulled by a fraction of the dragged node's displacement, then
 * eased back toward their home position with a damped spring. On release the
 * dragged node is launched with the cursor's release velocity and settles to
 * its home (also via spring + damping) so it feels like dropping a weight on
 * an elastic surface rather than a hard snap.
 */
export function startDragSim(args: DragSimArgs): DragSim {
  const { sigma, graph, draggedId, neighborIds, getHome } = args;

  const draggedHome = getHome(draggedId) ?? {
    x: graph.getNodeAttribute(draggedId, "x") as number,
    y: graph.getNodeAttribute(draggedId, "y") as number,
  };

  const neighbors: NeighborState[] = neighborIds
    .map((id) => {
      const home = getHome(id);
      if (!home) return null;
      return {
        id,
        home,
        startX: graph.getNodeAttribute(id, "x") as number,
        startY: graph.getNodeAttribute(id, "y") as number,
        vx: 0,
        vy: 0,
      };
    })
    .filter((n): n is NeighborState => n !== null);

  let draggedX = graph.getNodeAttribute(draggedId, "x") as number;
  let draggedY = graph.getNodeAttribute(draggedId, "y") as number;
  let draggedVx = 0;
  let draggedVy = 0;
  let mode: "drag" | "settle" = "drag";
  let raf = 0;
  let stopped = false;
  let lastFrame = 0;

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    if (now - lastFrame < FRAME_INTERVAL_MS) {
      raf = requestAnimationFrame(tick);
      return;
    }
    lastFrame = now;

    if (mode === "settle") {
      const dxd = draggedHome.x - draggedX;
      const dyd = draggedHome.y - draggedY;
      draggedVx = (draggedVx + dxd * SPRING_K) * DAMPING;
      draggedVy = (draggedVy + dyd * SPRING_K) * DAMPING;
      draggedX += draggedVx;
      draggedY += draggedVy;
      graph.setNodeAttribute(draggedId, "x", draggedX);
      graph.setNodeAttribute(draggedId, "y", draggedY);
    }

    const dxFromHome = draggedX - draggedHome.x;
    const dyFromHome = draggedY - draggedHome.y;

    let ke = draggedVx * draggedVx + draggedVy * draggedVy;

    for (const n of neighbors) {
      const offsetX = clamp(dxFromHome * NEIGHBOR_PULL, -MAX_OFFSET, MAX_OFFSET);
      const offsetY = clamp(dyFromHome * NEIGHBOR_PULL, -MAX_OFFSET, MAX_OFFSET);
      const targetX = n.home.x + offsetX;
      const targetY = n.home.y + offsetY;
      const curX = graph.getNodeAttribute(n.id, "x") as number;
      const curY = graph.getNodeAttribute(n.id, "y") as number;
      const fx = (targetX - curX) * SPRING_K;
      const fy = (targetY - curY) * SPRING_K;
      n.vx = (n.vx + fx) * DAMPING;
      n.vy = (n.vy + fy) * DAMPING;
      const nextX = curX + n.vx;
      const nextY = curY + n.vy;
      graph.setNodeAttribute(n.id, "x", nextX);
      graph.setNodeAttribute(n.id, "y", nextY);
      ke += n.vx * n.vx + n.vy * n.vy;
    }

    sigma.refresh({ skipIndexation: true });

    if (mode === "settle" && ke < STOP_KE) {
      for (const n of neighbors) {
        graph.setNodeAttribute(n.id, "x", n.home.x);
        graph.setNodeAttribute(n.id, "y", n.home.y);
      }
      graph.setNodeAttribute(draggedId, "x", draggedHome.x);
      graph.setNodeAttribute(draggedId, "y", draggedHome.y);
      sigma.refresh({ skipIndexation: true });
      stopped = true;
      return;
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return {
    setDraggedPos: (x, y) => {
      if (mode !== "drag") return;
      draggedVx = x - draggedX;
      draggedVy = y - draggedY;
      draggedX = x;
      draggedY = y;
      graph.setNodeAttribute(draggedId, "x", x);
      graph.setNodeAttribute(draggedId, "y", y);
    },
    release: (vx, vy) => {
      mode = "settle";
      draggedVx = clamp(vx, -40, 40);
      draggedVy = clamp(vy, -40, 40);
    },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

import type Graph from "graphology";
import type Sigma from "sigma";
import type { FrameLoop } from "./frameLoop";
import type { XY } from "./layouts";
import { resolveOverlaps } from "./overlap";
import {
  applyRepulsion,
  makeBodies,
  makeSprings,
  unitsPerPxOf,
} from "./fluidForces";

/**
 * Fluid drag simulation: while a node is dragged, every participant node
 * (whole graph up to a budget, otherwise a BFS neighborhood — see
 * fluidForces.ts) is integrated with edge springs, hop-weighted home anchors,
 * and short-range repulsion, so a drag ripples through the graph instead of
 * stretching one elastic patch.
 *
 * Runs as a tick on the shared FrameLoop — no rAF chain of its own — writing
 * positions via graph attributes (Sigma 3 re-reads x/y from attrs; reducer
 * overrides are discarded). Release behavior is decided by ``getReleaseMode``:
 * "sticky" keeps the settled positions and reports them via ``onSettled``;
 * "elastic" springs everything back and snaps exactly to home.
 */

export type ReleaseMode = "sticky" | "elastic";

export interface DragSim {
  setDraggedPos: (x: number, y: number) => void;
  release: (vx: number, vy: number) => void;
  /** Halt the sim. Mid-settle this completes the settle instantly (elastic
   * snaps home, sticky re-homes + reports), so homes never go stale. */
  stop: () => void;
}

interface FluidSimArgs {
  sigma: Sigma;
  graph: Graph;
  frameLoop: FrameLoop;
  draggedId: string;
  getHome: (id: string) => XY | undefined;
  getReleaseMode: () => ReleaseMode;
  onSettled?: (positions: Map<string, XY>) => void;
}

const K_EDGE = 0.04;
const ELASTIC_RETURN_K = 0.08;
const STICKY_SETTLE_K = 0.03;
const DAMPING = 0.85;
const MAX_SPEED = 40;
const RELEASE_KICK = 40;
const STOP_KE_PER_NODE = 0.02;
// 30fps self-throttle, matching the breathing tick's cadence.
const FRAME_INTERVAL_MS = 33;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function startFluidSim(args: FluidSimArgs): DragSim {
  const { sigma, graph, frameLoop, draggedId, getHome, getReleaseMode, onSettled } =
    args;

  const bodies = makeBodies(graph, draggedId, getHome);
  const springs = makeSprings(graph, bodies);
  const unitsPerPx = unitsPerPxOf(bodies);
  const n = bodies.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  let mode: "drag" | "settle" = "drag";
  let releaseMode: ReleaseMode = "elastic";
  let remove: (() => void) | null = null;
  let lastFrame = 0;

  const detachTick = (): void => {
    remove?.();
    remove = null;
  };

  const finish = (): void => {
    detachTick();
    if (releaseMode === "elastic") {
      for (const b of bodies) {
        graph.setNodeAttribute(b.id, "x", b.home.x);
        graph.setNodeAttribute(b.id, "y", b.home.y);
      }
      sigma.refresh();
      return;
    }
    resolveOverlaps(graph);
    sigma.refresh();
    const positions = new Map<string, XY>();
    graph.forEachNode((id, attrs) => {
      positions.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
    });
    onSettled?.(positions);
  };

  const accumulateForces = (): void => {
    fx.fill(0);
    fy.fill(0);
    for (const s of springs) {
      const a = bodies[s.a]!;
      const b = bodies[s.b]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) continue;
      const f = K_EDGE * (dist - s.rest);
      fx[s.a]! += (dx / dist) * f;
      fy[s.a]! += (dy / dist) * f;
      fx[s.b]! -= (dx / dist) * f;
      fy[s.b]! -= (dy / dist) * f;
    }
    for (let i = 0; i < n; i++) {
      const b = bodies[i]!;
      fx[i]! += (b.home.x - b.x) * b.anchorK;
      fy[i]! += (b.home.y - b.y) * b.anchorK;
    }
    applyRepulsion(bodies, fx, fy, unitsPerPx);
  };

  const tick = (now: number): boolean => {
    if (now - lastFrame < FRAME_INTERVAL_MS) return false;
    lastFrame = now;
    accumulateForces();
    let ke = 0;
    for (let i = 0; i < n; i++) {
      // Dragged node is pinned to the cursor while dragging (infinite mass).
      if (mode === "drag" && i === 0) continue;
      const b = bodies[i]!;
      b.vx = (b.vx + fx[i]!) * DAMPING;
      b.vy = (b.vy + fy[i]!) * DAMPING;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > MAX_SPEED) {
        b.vx *= MAX_SPEED / speed;
        b.vy *= MAX_SPEED / speed;
      }
      b.x += b.vx;
      b.y += b.vy;
      graph.setNodeAttribute(b.id, "x", b.x);
      graph.setNodeAttribute(b.id, "y", b.y);
      ke += b.vx * b.vx + b.vy * b.vy;
    }
    if (mode === "settle" && ke < STOP_KE_PER_NODE * n) {
      finish();
      return false; // finish() already did a full refresh
    }
    return true;
  };

  remove = frameLoop.add(tick);

  return {
    setDraggedPos: (x, y) => {
      if (mode !== "drag") return;
      const d = bodies[0]!;
      d.vx = x - d.x;
      d.vy = y - d.y;
      d.x = x;
      d.y = y;
      graph.setNodeAttribute(d.id, "x", x);
      graph.setNodeAttribute(d.id, "y", y);
    },
    release: (vx, vy) => {
      if (mode !== "drag") return;
      mode = "settle";
      releaseMode = getReleaseMode();
      const d = bodies[0]!;
      d.vx = clamp(vx, -RELEASE_KICK, RELEASE_KICK);
      d.vy = clamp(vy, -RELEASE_KICK, RELEASE_KICK);
      if (releaseMode === "sticky") {
        // Re-home everything where it is: anchors and springs now hold the
        // dragged shape, so only the release kick keeps things moving.
        for (const b of bodies) {
          b.home = { x: b.x, y: b.y };
          b.anchorK = STICKY_SETTLE_K;
        }
        d.anchorK = 0; // the kick decides where the dragged node lands
        for (const s of springs) {
          const a = bodies[s.a]!;
          const b = bodies[s.b]!;
          s.rest = Math.hypot(b.x - a.x, b.y - a.y);
        }
      } else {
        for (const b of bodies) b.anchorK = ELASTIC_RETURN_K;
      }
    },
    stop: () => {
      // Halting a released sim mid-flight must not strand the graph between
      // states: finish() applies the release contract immediately (elastic
      // snaps everything home; sticky resolves overlaps and reports the
      // positions as new homes). Without this, grabbing another node during
      // a sticky settle left basePositions stale — anchors then dragged the
      // neighborhood back toward pre-drag positions, undoing the last drag.
      // After a natural finish `remove` is null, so this is a plain no-op.
      if (remove !== null && mode === "settle") {
        finish();
        return;
      }
      detachTick();
    },
  };
}

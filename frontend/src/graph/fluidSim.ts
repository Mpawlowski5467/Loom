import type Graph from "graphology";
import type Sigma from "sigma";
import type { FrameLoop } from "./frameLoop";
import type { XY } from "./layouts";
import { resolveOverlaps } from "./overlap";
import {
  applyRepulsion,
  makeBodies,
  makeSpringNetwork,
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
  /** Fires once after a natural settle or an explicit stop has completed the
   * release/cancellation contract. */
  onFinished?: () => void;
}

const K_EDGE = 0.04;
const ELASTIC_RETURN_K = 0.08;
const STICKY_SETTLE_K = 0.03;
const DAMPING = 0.85;
const MAX_SPEED = 40;
// Keep release inertia subtle. A browser can deliver several pointer samples
// in a few milliseconds (especially automation or a high-Hz mouse); allowing
// that normalized velocity through at the old cap could fling a small filtered
// subgraph hundreds of graph units beyond the drop point.
const RELEASE_KICK = 0.25;
const STOP_KE_PER_NODE = 0.02;
// Reactions run at the display cadence. Heavy Graphology/Sigma work is batched
// below, so 60fps no longer means hundreds of graph events per frame.
const FRAME_INTERVAL_MS = 16;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function startFluidSim(args: FluidSimArgs): DragSim {
  const {
    sigma,
    graph,
    frameLoop,
    draggedId,
    getHome,
    getReleaseMode,
    onSettled,
    onFinished,
  } = args;

  const bodies = makeBodies(graph, draggedId, getHome);
  const { springs, affectedEdges } = makeSpringNetwork(graph, bodies);
  const participantIds = bodies.map((body) => body.id);
  const unitsPerPx = unitsPerPxOf(bodies);
  const n = bodies.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  let mode: "drag" | "settle" = "drag";
  let releaseMode: ReleaseMode = "elastic";
  let remove: (() => void) | null = null;
  let lastFrame = 0;
  let finished = false;

  const detachTick = (): void => {
    remove?.();
    remove = null;
  };

  const notifyFinished = (): void => {
    if (finished) return;
    finished = true;
    onFinished?.();
  };

  const finish = (): void => {
    detachTick();
    if (releaseMode === "elastic") {
      for (const b of bodies) {
        b.attrs["x"] = b.home.x;
        b.attrs["y"] = b.home.y;
      }
      sigma.refresh();
      notifyFinished();
      return;
    }
    resolveOverlaps(graph, {
      nodeIds: participantIds,
      ignoreHidden: true,
    });
    sigma.refresh();
    const positions = new Map<string, XY>();
    graph.forEachNode((id, attrs) => {
      positions.set(id, { x: attrs["x"] as number, y: attrs["y"] as number });
    });
    onSettled?.(positions);
    notifyFinished();
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
      b.attrs["x"] = b.x;
      b.attrs["y"] = b.y;
      ke += b.vx * b.vx + b.vy * b.vy;
    }
    if (mode === "settle" && ke < STOP_KE_PER_NODE * n) {
      finish();
      return false; // finish() already did a full refresh
    }
    // Reprocess just the moving nodes and every incident edge. Direct
    // attribute mutation above deliberately bypasses Graphology's
    // per-attribute events; this is the single scheduled renderer update for
    // the simulation frame. Position changes require Sigma to rebuild its
    // program indices: `skipIndexation` is intentionally false. Some visible
    // edges have no reusable program slot in large graphs, and Sigma throws if
    // asked to repaint those through the skip-indexation fast path.
    sigma.refresh({
      partialGraph: { nodes: participantIds, edges: affectedEdges },
      schedule: true,
    });
    // Sigma owns the refresh for this tick; returning false prevents the shared
    // FrameLoop from issuing its additional whole-graph refresh.
    return false;
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
      d.attrs["x"] = x;
      d.attrs["y"] = y;
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
      if (remove !== null && mode === "drag") {
        // Cancellation (window blur, filter/layout switch, rebuild) follows
        // the same elastic contract as a normal release. Otherwise a cancelled
        // pointer gesture could strand the node wherever the cursor vanished.
        for (const b of bodies) {
          b.attrs["x"] = b.home.x;
          b.attrs["y"] = b.home.y;
        }
        detachTick();
        sigma.refresh();
        notifyFinished();
        return;
      }
      detachTick();
      notifyFinished();
    },
  };
}

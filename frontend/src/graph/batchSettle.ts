import type Graph from "graphology";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import type Sigma from "sigma";
import type { FrameLoop } from "./frameLoop";
import type { TweenHandle } from "./layoutTransition";
import { constellationFA2Settings } from "./layouts";
import type { XY } from "./orbitScenes";
import { resolveOverlaps } from "./overlap";

/**
 * Off-main-thread settle for a large structural batch.
 *
 * The in-place sync seeds each new node beside its neighbors and relaxes it
 * locally, which suits a few new notes. A big import or bulk agent run, where
 * the new nodes outnumber the survivors, would otherwise stay as blobs around
 * the centroids plus a ring of orphans. This runs ForceAtlas2 in a web worker
 * for a bounded time over a copy of the graph in which every survivor is
 * pinned (FA2's ``fixed``), streams the batch's positions into the live graph
 * on the shared frame loop, and records where they settle as their homes so
 * drag spring-back stays correct. The camera and the held view frame are
 * never touched.
 */

/** Below this many new nodes the synchronous placement always suffices. */
export const BATCH_SETTLE_MIN_NODES = 12;
/** Above this many new nodes the worker settle always runs. */
export const BATCH_SETTLE_LARGE_NODES = 50;
/** Wall-clock budget for one worker run. */
export const BATCH_SETTLE_MS = 2000;

interface Ref<T> {
  current: T;
}

type Attrs = Record<string, unknown>;

/** Whether a batch adding ``added`` nodes beside ``survivors`` existing ones
 * needs the worker settle on top of placement and the local relax. */
export function isLargeBatch(added: number, survivors: number): boolean {
  if (added < BATCH_SETTLE_MIN_NODES) return false;
  return added > BATCH_SETTLE_LARGE_NODES || added > survivors;
}

export interface BatchSettleOptions {
  graph: Graph;
  sigma: Sigma;
  frameLoop: FrameLoop;
  /** The batch's new nodes. Every other node stays where it is. */
  ids: string[];
  /** Constellation homes; the batch's settled positions are written here. */
  homesRef: Ref<Map<string, XY>>;
  durationMs?: number;
}

/**
 * Start the worker settle. The returned handle's ``cancel`` stops the worker
 * and leaves the batch where it is now, recorded as its homes; on its own the
 * run ends after ``durationMs`` (a timer, so a hidden tab without animation
 * frames still releases the worker). Returns null when no worker can run, in
 * which case the synchronous placement stands.
 */
export function startBatchSettle(opts: BatchSettleOptions): TweenHandle | null {
  const { graph, sigma, frameLoop, homesRef } = opts;
  const ids = opts.ids.filter((id) => graph.hasNode(id));
  if (ids.length === 0 || typeof Worker === "undefined") return null;
  const scratch = pinnedCopy(graph, new Set(ids));
  let layout: FA2Layout;
  try {
    layout = new FA2Layout(scratch, {
      settings: constellationFA2Settings(scratch),
    });
    layout.start();
  } catch {
    // A worker the page may not spawn (CSP, sandbox) keeps the placement.
    return null;
  }

  // Written in place, as the drag sim does: the frame loop then repaints
  // once per frame instead of Sigma reacting to an event per node.
  const live = ids.map((id) => graph.getNodeAttributes(id) as Attrs);
  const stream = (): boolean => {
    let moved = false;
    ids.forEach((id, i) => {
      const from = scratch.getNodeAttributes(id) as Attrs;
      const to = live[i]!;
      if (to["x"] === from["x"] && to["y"] === from["y"]) return;
      to["x"] = from["x"];
      to["y"] = from["y"];
      moved = true;
    });
    return moved;
  };
  const commitHomes = (): void => {
    const homes = homesRef.current;
    ids.forEach((id, i) => {
      if (!graph.hasNode(id)) return;
      homes.set(id, { x: live[i]!["x"] as number, y: live[i]!["y"] as number });
    });
  };

  let running = true;
  const removeTick = frameLoop.add(stream);
  const stop = (): void => {
    running = false;
    window.clearTimeout(timer);
    removeTick();
    layout.kill();
  };
  const timer = window.setTimeout(() => {
    stop();
    stream();
    // FA2 has no collision term; relax the disks it left stacked.
    resolveOverlaps(graph, { nodeIds: ids });
    commitHomes();
    sigma.refresh();
  }, opts.durationMs ?? BATCH_SETTLE_MS);

  return {
    cancel: () => {
      if (!running) return;
      stop();
      commitHomes();
    },
  };
}

/** Positions and links only, with every node outside ``moving`` fixed. The
 * worker writes into this copy, never into the graph Sigma renders. */
function pinnedCopy(graph: Graph, moving: Set<string>): Graph {
  const copy = graph.nullCopy() as Graph;
  graph.forEachNode((id, attrs) => {
    copy.addNode(id, { x: attrs["x"], y: attrs["y"], fixed: !moving.has(id) });
  });
  graph.forEachEdge((_edge, _attrs, source, target) => {
    copy.addEdge(source, target);
  });
  return copy;
}

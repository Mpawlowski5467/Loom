import type Graph from "graphology";
import type Sigma from "sigma";
import type { XY } from "./layouts";

/**
 * Development-only handle exposed to browser tooling. `graphToViewport` reads
 * the latest Graphology attributes; `renderedToViewport` reads Sigma's display
 * cache and should be sampled from an `afterRender` listener when measuring
 * actual input-to-paint latency.
 */
export interface LoomGraphDebugHook {
  readonly sigma: Sigma;
  readonly graph: Graph;
  readonly buildStartedAt: number;
  readonly ready: boolean;
  readonly readyAt: number | null;
  graphToViewport: (id: string) => XY | null;
  renderedToViewport: (id: string) => XY | null;
  nodeAtViewport: (point: XY) => string | null;
  isDragging: () => boolean;
}

export interface LoomGraphDebugHost {
  __loomGraph?: LoomGraphDebugHook;
}

declare global {
  interface Window {
    __loomGraph?: LoomGraphDebugHook;
  }
}

interface InstallGraphDebugHookArgs {
  host: LoomGraphDebugHost;
  sigma: Sigma;
  graph: Graph;
  buildStartedAt: number;
  isDragging: () => boolean;
}

export interface GraphDebugHookControl {
  hook: LoomGraphDebugHook;
  markReady: (at?: number) => void;
  uninstall: () => void;
}

function finitePoint(point: XY): XY | null {
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

/**
 * Install one debug handle and return its lifecycle controls. Cleanup compares
 * object identity before deleting the global, so a late teardown from an old
 * graph build can never remove a newer build's handle.
 */
export function installGraphDebugHook(
  args: InstallGraphDebugHookArgs,
): GraphDebugHookControl {
  const { host, sigma, graph, buildStartedAt, isDragging } = args;
  let ready = false;
  let readyAt: number | null = null;

  const hook: LoomGraphDebugHook = {
    sigma,
    graph,
    buildStartedAt,
    get ready() {
      return ready;
    },
    get readyAt() {
      return readyAt;
    },
    graphToViewport: (id) => {
      try {
        if (!graph.hasNode(id)) return null;
        const x = graph.getNodeAttribute(id, "x") as number;
        const y = graph.getNodeAttribute(id, "y") as number;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return finitePoint(sigma.graphToViewport({ x, y }));
      } catch {
        // A retained handle can be queried while its Sigma instance is being
        // torn down. Debug tooling should observe an unavailable point rather
        // than disturb application cleanup with an exception.
        return null;
      }
    },
    renderedToViewport: (id) => {
      try {
        const data = sigma.getNodeDisplayData(id);
        if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
          return null;
        }
        return finitePoint(
          sigma.framedGraphToViewport({ x: data.x, y: data.y }),
        );
      } catch {
        return null;
      }
    },
    nodeAtViewport: (point) => {
      try {
        const picker = sigma as unknown as {
          getNodeAtPosition: (position: XY) => string | null;
        };
        return picker.getNodeAtPosition(point);
      } catch {
        return null;
      }
    },
    isDragging,
  };

  host.__loomGraph = hook;

  return {
    hook,
    markReady: (at = performance.now()) => {
      if (ready) return;
      ready = true;
      readyAt = at;
    },
    uninstall: () => {
      ready = false;
      if (host.__loomGraph === hook) delete host.__loomGraph;
    },
  };
}

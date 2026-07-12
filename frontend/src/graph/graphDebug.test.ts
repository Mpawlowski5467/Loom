import { describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import {
  installGraphDebugHook,
  type LoomGraphDebugHook,
  type LoomGraphDebugHost,
} from "./graphDebug";

function setup() {
  const graph = new Graph();
  graph.addNode("node", { x: 12, y: 18 });

  const sigma = {
    graphToViewport: vi.fn(({ x, y }: { x: number; y: number }) => ({
      x: x + 100,
      y: y + 200,
    })),
    getNodeDisplayData: vi.fn((id: string) =>
      id === "node" ? { x: 0.25, y: 0.75 } : undefined,
    ),
    framedGraphToViewport: vi.fn(({ x, y }: { x: number; y: number }) => ({
      x: x * 400,
      y: y * 400,
    })),
    getNodeAtPosition: vi.fn(({ x, y }: { x: number; y: number }) =>
      x === 100 && y === 300 ? "node" : null,
    ),
  } as unknown as Sigma;
  const host: LoomGraphDebugHost = {};
  const dragging = { current: false };
  const control = installGraphDebugHook({
    host,
    sigma,
    graph,
    buildStartedAt: 10,
    isDragging: () => dragging.current,
  });
  return { graph, sigma, host, dragging, control };
}

describe("installGraphDebugHook", () => {
  it("reports build readiness and live drag state", () => {
    const { host, dragging, control } = setup();
    expect(host.__loomGraph).toBe(control.hook);
    expect(control.hook.buildStartedAt).toBe(10);
    expect(control.hook.ready).toBe(false);
    expect(control.hook.readyAt).toBeNull();

    control.markReady(42);
    expect(control.hook.ready).toBe(true);
    expect(control.hook.readyAt).toBe(42);

    // The first ready timestamp describes this build and stays stable.
    control.markReady(99);
    expect(control.hook.readyAt).toBe(42);
    dragging.current = true;
    expect(control.hook.isDragging()).toBe(true);
  });

  it("keeps live graph coordinates distinct from Sigma's rendered cache", () => {
    const { control, sigma } = setup();

    expect(control.hook.graphToViewport("node")).toEqual({ x: 112, y: 218 });
    expect(control.hook.renderedToViewport("node")).toEqual({ x: 100, y: 300 });
    expect(sigma.graphToViewport).toHaveBeenCalledWith({ x: 12, y: 18 });
    expect(sigma.framedGraphToViewport).toHaveBeenCalledWith({
      x: 0.25,
      y: 0.75,
    });
  });

  it("returns null for missing or invalid coordinates", () => {
    const { graph, control } = setup();
    graph.addNode("invalid", { x: Number.NaN, y: 1 });

    expect(control.hook.graphToViewport("missing")).toBeNull();
    expect(control.hook.graphToViewport("invalid")).toBeNull();
    expect(control.hook.renderedToViewport("missing")).toBeNull();
  });

  it("reports the node Sigma would pick at a viewport point", () => {
    const { control } = setup();
    expect(control.hook.nodeAtViewport({ x: 100, y: 300 })).toBe("node");
    expect(control.hook.nodeAtViewport({ x: 0, y: 0 })).toBeNull();
  });

  it("deletes only the hook installed by its own graph build", () => {
    const { host, control } = setup();
    control.markReady(42);

    const newer = { buildStartedAt: 50 } as LoomGraphDebugHook;
    host.__loomGraph = newer;
    control.uninstall();

    expect(host.__loomGraph).toBe(newer);
    expect(control.hook.ready).toBe(false);
  });

  it("removes its own hook on teardown", () => {
    const { host, control } = setup();
    control.uninstall();
    expect(host).not.toHaveProperty("__loomGraph");

    // Idempotent cleanup remains safe.
    control.uninstall();
    expect(host).not.toHaveProperty("__loomGraph");
  });
});

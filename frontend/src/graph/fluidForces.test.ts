import Graph from "graphology";
import { describe, expect, it } from "vitest";
import {
  MAX_PARTICIPANTS,
  applyRepulsion,
  collectParticipants,
  makeBodies,
  makeSpringNetwork,
  unitsPerPxOf,
} from "./fluidForces";

function chain(count: number): Graph {
  const graph = new Graph();
  for (let index = 0; index < count; index += 1) {
    graph.addNode(`n${index}`, { x: index * 10, y: 0, size: 4 });
    if (index > 0) graph.addEdge(`n${index - 1}`, `n${index}`);
  }
  return graph;
}

describe("fluid force construction", () => {
  it("bounds traversal on large graphs and excludes hidden neighbors", () => {
    const graph = chain(MAX_PARTICIPANTS + 50);
    graph.setNodeAttribute("n1", "hidden", true);

    const participants = collectParticipants(graph, "n0");

    expect(participants.size).toBe(1);
    expect(participants.has("n0")).toBe(true);
    expect(participants.has("n1")).toBe(false);
  });

  it("builds bodies and springs from stable home positions", () => {
    const graph = chain(3);
    const bodies = makeBodies(graph, "n0", (id) =>
      id === "n1" ? { x: 25, y: 5 } : undefined,
    );
    const network = makeSpringNetwork(graph, bodies);

    expect(bodies[0]!.id).toBe("n0");
    expect(bodies.find((body) => body.id === "n1")?.home).toEqual({
      x: 25,
      y: 5,
    });
    expect(network.springs).toHaveLength(2);
    expect(network.affectedEdges).toHaveLength(2);
    expect(unitsPerPxOf(bodies)).toBeGreaterThan(0);
  });

  it("applies equal and opposite repulsion to overlapping bodies", () => {
    const graph = chain(2);
    graph.setNodeAttribute("n1", "x", 0);
    const bodies = makeBodies(graph, "n0", () => undefined);
    const fx = new Float64Array(bodies.length);
    const fy = new Float64Array(bodies.length);

    applyRepulsion(bodies, fx, fy, 1);

    expect(fx[0]).toBeLessThan(0);
    expect(fx[1]).toBeGreaterThan(0);
    expect(fx[0]! + fx[1]!).toBeCloseTo(0);
    expect(fy[0]! + fy[1]!).toBeCloseTo(0);
  });
});

import { describe, expect, it } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import { buildGraphSvg, serializeVisibleGraph } from "./export";

function graphFixture(): Graph {
  const graph = new Graph();
  graph.addNode("visible-a", {
    x: 10,
    y: 20,
    size: 4,
    color: "#111111",
    label: "Visible Alpha",
  });
  graph.addNode("visible-b", {
    x: 30,
    y: 40,
    size: 4,
    color: "#222222",
    label: "Visible Beta",
  });
  graph.addNode("hidden", {
    x: 50,
    y: 60,
    size: 4,
    color: "#333333",
    label: "Secret Hidden Label",
    hidden: true,
  });
  graph.addEdge("visible-a", "visible-b", { color: "#aaaaaa" });
  graph.addEdge("visible-a", "hidden", { color: "#bbbbbb" });
  return graph;
}

function fakeSigma(): Sigma {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  document.body.appendChild(container);
  return {
    getContainer: () => container,
    getSetting: () => 0,
    getCamera: () => ({ ratio: 1 }),
    graphToViewport: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  } as unknown as Sigma;
}

describe("serializeVisibleGraph", () => {
  it("omits hidden nodes and every incident edge", () => {
    const data = serializeVisibleGraph(graphFixture());
    expect(data.nodes.map((node) => node.key)).toEqual([
      "visible-a",
      "visible-b",
    ]);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]).toMatchObject({
      source: "visible-a",
      target: "visible-b",
    });
  });
});

describe("buildGraphSvg", () => {
  it("renders only visible nodes and edges", () => {
    const svg = buildGraphSvg(fakeSigma(), graphFixture());
    expect(svg).toContain("Visible Alpha");
    expect(svg).toContain("Visible Beta");
    expect(svg).not.toContain("Secret Hidden Label");
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg.match(/<line /g)).toHaveLength(1);
  });
});

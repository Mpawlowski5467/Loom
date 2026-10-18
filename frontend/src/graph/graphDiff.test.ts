import { describe, expect, it } from "vitest";
import Graph from "graphology";
import type { Note, NoteId } from "../data/types";
import {
  adjacencyFor,
  desiredStructure,
  diffGraphStructure,
  edgePairKey,
  isEmptyDiff,
} from "./graphDiff";
import { buildGraph } from "./graphModel";

function note(id: string, links: string[] = []): Note {
  return {
    id: id as NoteId,
    title: id,
    type: "topic",
    links: links as NoteId[],
  } as unknown as Note;
}

describe("desiredStructure", () => {
  it("collapses a<->b to one edge in the first-seen direction", () => {
    const d = desiredStructure([note("b", ["a"]), note("a", ["b"])]);
    expect([...d.edges.values()]).toEqual([["b", "a"]]);
    expect(d.edges.has(edgePairKey("a", "b"))).toBe(true);
  });

  it("drops links to notes that are not present", () => {
    const d = desiredStructure([note("a", ["ghost", "b"]), note("b")]);
    expect([...d.edges.values()]).toEqual([["a", "b"]]);
  });

  it("matches the edges buildGraph creates", () => {
    const notes = [
      note("a", ["b", "c", "missing"]),
      note("b", ["a", "c"]),
      note("c", ["c"]),
    ];
    const { graph } = buildGraph(notes);
    const built = graph.mapEdges((_e, _a, s, t) => `${s}>${t}`);
    const desired = [...desiredStructure(notes).edges.values()].map(
      ([s, t]) => `${s}>${t}`,
    );
    expect(desired).toEqual(built);
  });
});

describe("diffGraphStructure", () => {
  function graphOf(notes: Note[]): Graph {
    return buildGraph(notes).graph;
  }

  it("is empty when the structure is unchanged", () => {
    const notes = [note("a", ["b"]), note("b")];
    const diff = diffGraphStructure(graphOf(notes), desiredStructure(notes));
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("treats a reversed link as the same edge", () => {
    const graph = graphOf([note("a", ["b"]), note("b")]);
    const diff = diffGraphStructure(
      graph,
      desiredStructure([note("a"), note("b", ["a"])]),
    );
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("reports added nodes in notes order with their new edges", () => {
    const graph = graphOf([note("a"), note("b")]);
    const diff = diffGraphStructure(
      graph,
      desiredStructure([
        note("a", ["d"]),
        note("b"),
        note("d"),
        note("c", ["a"]),
      ]),
    );
    expect(diff.addedNodes).toEqual(["d", "c"]);
    expect(diff.addedEdges).toEqual([
      ["a", "d"],
      ["c", "a"],
    ]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.removedEdges).toEqual([]);
  });

  it("leaves edges of a removed node to the node drop", () => {
    const graph = graphOf([note("a", ["b"]), note("b", ["c"]), note("c")]);
    const diff = diffGraphStructure(
      graph,
      desiredStructure([note("a"), note("c")]),
    );
    expect(diff.removedNodes).toEqual(["b"]);
    expect(diff.removedEdges).toEqual([]);
    expect(diff.addedEdges).toEqual([]);
  });

  it("reports an unlinked pair between surviving nodes", () => {
    const graph = graphOf([note("a", ["b", "c"]), note("b"), note("c")]);
    const diff = diffGraphStructure(
      graph,
      desiredStructure([note("a", ["c"]), note("b"), note("c")]),
    );
    expect(diff.removedEdges).toEqual([graph.edge("a", "b")]);
    expect(diff.addedEdges).toEqual([]);
    expect(diff.addedNodes).toEqual([]);
  });
});

describe("adjacencyFor", () => {
  it("lists undirected neighbors for the requested ids only", () => {
    const d = desiredStructure([
      note("a", ["b", "a"]),
      note("b", ["c"]),
      note("c"),
    ]);
    const adj = adjacencyFor(d, ["b", "a"]);
    expect(adj.get("b")).toEqual(["a", "c"]);
    // The self link is skipped.
    expect(adj.get("a")).toEqual(["b"]);
    expect(adj.has("c")).toBe(false);
  });
});

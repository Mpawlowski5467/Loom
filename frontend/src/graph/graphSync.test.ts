import { describe, expect, it, vi } from "vitest";
import type Graph from "graphology";
import type Sigma from "sigma";
import type { NodeType, Note, NoteId } from "../data/types";
import { seededRandom } from "../test/seededRandom";
import { buildGraph } from "./graphModel";
import { patchGraphContent, syncGraphStructure } from "./graphSync";
import { BATCH_SETTLE_MIN_NODES } from "./batchSettle";
import type { XY } from "./orbitScenes";
import { computeEdgeExtremities } from "./reducers";
import { collectNodeZ } from "./depth";
import { GRAPH_LABEL_BUDGET_NODES, type GraphTuning } from "./tuning";

function note(
  id: string,
  links: string[] = [],
  type: NodeType = "topic",
): Note {
  return {
    id: id as NoteId,
    title: id,
    type,
    links: links as NoteId[],
  } as unknown as Note;
}

function makeTuning(overrides: Partial<GraphTuning> = {}): GraphTuning {
  return {
    hovered: null,
    selected: null,
    isolateNeighbors: false,
    visibilityRestricted: false,
    dragging: false,
    filters: new Set(),
    palette: {
      edge: "#000",
      edgeHover: "#000",
      edgeFaint: "#000",
      label: "#000",
      nodeDimmed: "#000",
    },
    graphMode: "constellation",
    sizeScale: 2,
    travelerPace: 1,
    labelsEnabled: true,
    labelShowRatio: 0.55,
    labelThreshold: 7,
    travelersEnabled: true,
    edgeThickness: 1,
    depthEnabled: true,
    cameraRatio: 1,
    labelTier: 0,
    lensLabelHideFor: null,
    degree: new Map(),
    ...overrides,
  };
}

type BBox = { x: [number, number]; y: [number, number] };

/** The Sigma surface the sync touches: frame + settings + refresh. */
function stubSigma(graph: Graph) {
  let custom: BBox | null = null;
  const extent = (): BBox => {
    const xs = graph.mapNodes((_id, a) => a["x"] as number);
    const ys = graph.mapNodes((_id, a) => a["y"] as number);
    return {
      x: [Math.min(...xs), Math.max(...xs)],
      y: [Math.min(...ys), Math.max(...ys)],
    };
  };
  const bboxAtBuild = extent();
  const sigma = {
    getBBox: () => bboxAtBuild,
    getCustomBBox: () => custom,
    setCustomBBox: vi.fn((b: BBox | null) => {
      custom = b;
    }),
    setSetting: vi.fn(),
    refresh: vi.fn(),
  };
  return { sigma, frame: () => custom };
}

/** A laid-out graph: a 5-note chain a—b—c—d—e spaced 100 apart on x. */
function setup(
  notes: Note[] = [
    note("a", ["b"]),
    note("b", ["c"]),
    note("c", ["d"]),
    note("d", ["e"]),
    note("e"),
  ],
  tuning = makeTuning(),
) {
  const { graph, baseSizes } = buildGraph(notes);
  const homes = new Map<string, XY>();
  graph.forEachNode((id) => {
    const p = { x: homes.size * 100, y: 0 };
    graph.mergeNodeAttributes(id, p);
    homes.set(id, { ...p });
  });
  const { sigma, frame } = stubSigma(graph);
  const travelers = { sync: vi.fn() };
  const haltMotion = vi.fn();
  const settleBatch = vi.fn();
  const target = {
    graph,
    sigma: sigma as unknown as Sigma,
    tuning,
    baseSizesRef: { current: baseSizes },
    basePositionsRef: { current: homes },
    edgeExtremities: computeEdgeExtremities(graph),
    nodeZ: collectNodeZ(graph),
    travelers,
    heavy: false,
    haltMotion,
    settleBatch,
    random: seededRandom(9),
  };
  return { target, graph, sigma, frame, travelers, haltMotion, settleBatch };
}

function pos(graph: Graph, id: string): XY {
  return {
    x: graph.getNodeAttribute(id, "x") as number,
    y: graph.getNodeAttribute(id, "y") as number,
  };
}

const chain = (): Note[] => [
  note("a", ["b"]),
  note("b", ["c"]),
  note("c", ["d"]),
  note("d", ["e"]),
  note("e"),
];

/** A bulk import: ``count`` new notes, each linked to a chain note. */
const imported = (count: number): Note[] =>
  Array.from({ length: count }, (_, i) => note(`i${i}`, ["abcde"[i % 5]!]));

describe("syncGraphStructure", () => {
  it("reports unchanged without touching the renderer", () => {
    const { target, sigma, haltMotion } = setup();
    expect(syncGraphStructure(target, chain())).toBe("unchanged");
    expect(haltMotion).not.toHaveBeenCalled();
    expect(sigma.refresh).not.toHaveBeenCalled();
  });

  it("adds a linked note beside its neighbor and leaves the rest in place", () => {
    const { target, graph, sigma, travelers, haltMotion } = setup();
    const before = new Map(graph.mapNodes((id) => [id, pos(graph, id)]));

    const notes = [...chain(), note("n", ["c"], "project")];
    expect(syncGraphStructure(target, notes)).toBe("applied");

    // The new node arrives with its full attribute set…
    expect(graph.getNodeAttribute("n", "label")).toBe("n");
    expect(graph.getNodeAttribute("n", "noteType")).toBe("project");
    expect(graph.getNodeAttribute("n", "z")).toBe(target.nodeZ.get("n"));
    expect(graph.getNodeAttribute("n", "size")).toBe(
      target.baseSizesRef.current.get("n")! * 2,
    );
    // …near its neighbor's home, which is also its own new home.
    const n = pos(graph, "n");
    expect(Math.hypot(n.x - 200, n.y)).toBeLessThan(200);
    expect(target.basePositionsRef.current.get("n")).toEqual(n);
    // The edge exists and the reducer cache knows it.
    const edge = graph.edge("n", "c")!;
    expect(target.edgeExtremities.get(edge)).toEqual(["n", "c"]);
    // Every existing node keeps its exact position.
    for (const [id, p] of before) expect(pos(graph, id)).toEqual(p);

    expect(haltMotion).toHaveBeenCalledTimes(1);
    expect(travelers.sync).toHaveBeenCalledTimes(1);
    expect(sigma.refresh).toHaveBeenCalled();
  });

  it("drops a removed note, its edges and its cache entries", () => {
    const tuning = makeTuning({ hovered: "c" });
    const { target, graph } = setup(chain(), tuning);
    const edgeBC = graph.edge("b", "c")!;

    const notes = [note("a", ["b"]), note("b"), note("d", ["e"]), note("e")];
    expect(syncGraphStructure(target, notes)).toBe("applied");

    expect(graph.hasNode("c")).toBe(false);
    expect(graph.size).toBe(2); // a—b and d—e remain
    expect(target.edgeExtremities.has(edgeBC)).toBe(false);
    expect(target.basePositionsRef.current.has("c")).toBe(false);
    expect(target.baseSizesRef.current.has("c")).toBe(false);
    expect(target.nodeZ.has("c")).toBe(false);
    // A hover on the dropped node is released.
    expect(tuning.hovered).toBeNull();
  });

  it("restyles both endpoints when only a link is added", () => {
    const { target, graph } = setup();
    const sizeBefore = target.baseSizesRef.current.get("a")!;
    const before = new Map(graph.mapNodes((id) => [id, pos(graph, id)]));

    const notes = chain();
    notes[0] = note("a", ["b", "e"]);
    expect(syncGraphStructure(target, notes)).toBe("applied");

    expect(graph.hasEdge("a", "e")).toBe(true);
    const sizeAfter = target.baseSizesRef.current.get("a")!;
    expect(sizeAfter).toBeGreaterThan(sizeBefore);
    expect(graph.getNodeAttribute("a", "size")).toBe(sizeAfter * 2);
    expect(target.nodeZ.get("a")).toBe(graph.getNodeAttribute("a", "z"));
    for (const [id, p] of before) expect(pos(graph, id)).toEqual(p);
  });

  it("holds the view frame when a rim node leaves", () => {
    const { target, frame } = setup();
    const notes = chain().slice(0, 4);
    notes[3] = note("d");
    syncGraphStructure(target, notes);
    // The frame stays at the pre-change extent (e at x=400) instead of
    // refitting to the shrunken graph.
    expect(frame()).toEqual({ x: [0, 400], y: [0, 0] });
  });

  it("holds the view frame when a node joins outside it", () => {
    const { target, frame } = setup();
    syncGraphStructure(target, [...chain(), note("orphan")]);
    // The orphan lands on the ring beyond the layout, but the frame stays
    // put so nothing already on screen shifts under the camera.
    expect(frame()).toEqual({ x: [0, 400], y: [0, 0] });
  });

  it("hides a new note of a filtered-out type and counts visible degree", () => {
    const tuning = makeTuning({ filters: new Set<NodeType>(["topic"]) });
    const { target, graph } = setup(chain(), tuning);
    syncGraphStructure(target, [...chain(), note("p", ["a"], "project")]);
    expect(graph.getNodeAttribute("p", "hidden")).toBe(true);
    expect(tuning.degree.has("a")).toBe(true);
    expect(tuning.visibilityRestricted).toBe(true);
  });

  it("seeds an orbit-mode node beside its neighbor's scene position", () => {
    const tuning = makeTuning({ graphMode: "orbit" });
    const { target, graph } = setup(chain(), tuning);
    // The scene owns live positions: scaled 10× and shifted far from the
    // constellation homes (c's home is x=200, its scene slot x=7000).
    graph.forEachNode((id, attrs) => {
      graph.mergeNodeAttributes(id, {
        x: (attrs["x"] as number) * 10 + 5000,
        y: 5000,
      });
    });

    syncGraphStructure(target, [...chain(), note("n", ["c"])]);

    const live = pos(graph, "n");
    const home = target.basePositionsRef.current.get("n")!;
    // Within one jitter radius of c's scene slot (scene spacing ≈ 1585)…
    expect(Math.hypot(live.x - 7000, live.y - 5000)).toBeLessThan(1000);
    // …while its home sits beside c's constellation home.
    expect(Math.hypot(home.x - 200, home.y)).toBeLessThan(200);
  });

  it("hands a batch that outnumbers the survivors to the worker settle", () => {
    const { target, frame, settleBatch } = setup();
    const batch = imported(BATCH_SETTLE_MIN_NODES);
    expect(syncGraphStructure(target, [...chain(), ...batch])).toBe("applied");
    // Placed in place first, then settled; the frame stays held.
    expect(settleBatch).toHaveBeenCalledTimes(1);
    expect(settleBatch).toHaveBeenCalledWith(batch.map((n) => n.id));
    expect(frame()).toEqual({ x: [0, 400], y: [0, 0] });
  });

  it("keeps a small batch on the synchronous path", () => {
    const { target, settleBatch } = setup();
    const batch = imported(BATCH_SETTLE_MIN_NODES - 1);
    syncGraphStructure(target, [...chain(), ...batch]);
    expect(settleBatch).not.toHaveBeenCalled();
  });

  it("leaves a large batch to the scene restage in an orbit layout", () => {
    const tuning = makeTuning({ graphMode: "orbit" });
    const { target, settleBatch } = setup(chain(), tuning);
    syncGraphStructure(target, [...chain(), ...imported(40)]);
    expect(settleBatch).not.toHaveBeenCalled();
  });

  it("asks for a rebuild when nothing survives", () => {
    const { target, graph, haltMotion } = setup();
    expect(syncGraphStructure(target, [note("x"), note("y")])).toBe("rebuild");
    expect(graph.order).toBe(5);
    expect(haltMotion).not.toHaveBeenCalled();
  });

  it("asks for a rebuild when the overlay perf budget flips", () => {
    const { target } = setup();
    const many = Array.from({ length: GRAPH_LABEL_BUDGET_NODES + 1 }, (_, i) =>
      note(`m${i}`),
    );
    expect(syncGraphStructure(target, [...chain(), ...many])).toBe("rebuild");
  });
});

describe("patchGraphContent", () => {
  it("patches titles and types onto existing nodes", () => {
    const { graph } = setup();
    const notes = chain();
    notes[0] = { ...notes[0]!, title: "Renamed" };
    notes[1] = note("b", ["c"], "people");

    const result = patchGraphContent(graph, notes);

    expect(result).toEqual({ changed: true, typeChanged: true });
    expect(graph.getNodeAttribute("a", "label")).toBe("Renamed");
    expect(graph.getNodeAttribute("b", "noteType")).toBe("people");
    expect(graph.getNodeAttribute("b", "color")).not.toBe(
      graph.getNodeAttribute("c", "color"),
    );
    expect(patchGraphContent(graph, notes)).toEqual({
      changed: false,
      typeChanged: false,
    });
  });
});

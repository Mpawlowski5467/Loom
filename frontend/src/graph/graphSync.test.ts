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
import { DEFAULT_NODE_FILTER } from "./nodeFilter";
import { defaultNodeContext, typePaint } from "./graphModel";

function note(
  id: string,
  links: string[] = [],
  type: NodeType = "topic",
): Note {
  return {
    id: id as NoteId,
    title: id,
    type,
    folder: `${type}s`,
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
    filter: DEFAULT_NODE_FILTER,
    nodeColor: typePaint(),
    communityOf: new Map(),
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

/**
 * The Sigma surface the sync touches: frame, settings, refresh and setGraph.
 * Graph-event wiring mirrors Sigma 3.0.2: while attached, every node or edge
 * drop re-indexes the whole graph, and setGraph rebinds to the new graph and
 * runs one full refresh. ``reindexes`` counts those full passes.
 */
function stubSigma(graph: Graph) {
  let custom: BBox | null = null;
  let attached = graph;
  let reindexes = 0;
  const onDrop = (): void => {
    reindexes++;
  };
  const bind = (g: Graph): void => {
    g.on("nodeDropped", onDrop);
    g.on("edgeDropped", onDrop);
  };
  const unbind = (g: Graph): void => {
    g.removeListener("nodeDropped", onDrop);
    g.removeListener("edgeDropped", onDrop);
  };
  bind(graph);
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
    getSetting: vi.fn(() => undefined),
    setSetting: vi.fn(),
    refresh: vi.fn(() => {
      reindexes++;
    }),
    setGraph: vi.fn((g: Graph) => {
      if (g === attached) return;
      unbind(attached);
      attached = g;
      bind(g);
      reindexes++;
    }),
  };
  return {
    sigma,
    frame: () => custom,
    reindexes: () => reindexes,
    attached: () => attached,
  };
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
  const { sigma, frame, reindexes, attached } = stubSigma(graph);
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
  return {
    target,
    graph,
    sigma,
    frame,
    travelers,
    haltMotion,
    settleBatch,
    reindexes,
    attached,
  };
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
    const { target, graph, travelers, haltMotion, attached } = setup();
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
    // Sigma is back on the live graph, which repaints it.
    expect(attached()).toBe(graph);
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

  it("re-indexes Sigma a constant number of times however many notes leave", () => {
    // A hub with 60 leaves; each leaf links to the hub and to the next leaf.
    const fan = (): Note[] => [
      note("hub"),
      ...Array.from({ length: 60 }, (_, i) =>
        note(`l${i}`, ["hub", `l${(i + 1) % 60}`]),
      ),
    ];
    const reindexesToRemove = (k: number): number => {
      const { target, graph, reindexes, attached } = setup(fan());
      const before = reindexes();
      expect(syncGraphStructure(target, fan().slice(0, 61 - k))).toBe(
        "applied",
      );
      expect(graph.order).toBe(61 - k);
      expect(attached()).toBe(graph);
      return reindexes() - before;
    };
    const few = reindexesToRemove(2);
    const many = reindexesToRemove(40);
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(2);

    // Sanity: the stub really charges a full pass per drop while attached,
    // which is what dropping 40 notes inline would have cost ~160 times.
    const { graph, reindexes } = setup(fan());
    const before = reindexes();
    graph.dropNode("l0");
    // Edges to hub, to l1 and from l59, then the node itself.
    expect(reindexes() - before).toBe(4);
  });

  it("re-attaches Sigma even when a mutation throws", () => {
    const { target, graph, attached } = setup();
    target.travelers.sync.mockImplementation(() => {
      throw new Error("overlay failure");
    });
    expect(() => syncGraphStructure(target, [...chain(), note("n")])).toThrow(
      "overlay failure",
    );
    expect(attached()).toBe(graph);
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

  it("hides a new note outside the folder filter and counts visible degree", () => {
    const tuning = makeTuning({
      filter: { ...DEFAULT_NODE_FILTER, folder: "topics" },
    });
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

    const result = patchGraphContent(graph, notes, defaultNodeContext());

    expect(result).toEqual({ changed: true, typeChanged: true });
    expect(graph.getNodeAttribute("a", "label")).toBe("Renamed");
    expect(graph.getNodeAttribute("b", "noteType")).toBe("people");
    expect(graph.getNodeAttribute("b", "color")).not.toBe(
      graph.getNodeAttribute("c", "color"),
    );
    expect(patchGraphContent(graph, notes, defaultNodeContext())).toEqual({
      changed: false,
      typeChanged: false,
    });
  });
});

import type { Note, NodeType } from "./types";

export const GRAPH_FIXTURE_SIZES = [500, 2000] as const;
export type GraphFixtureSize = (typeof GRAPH_FIXTURE_SIZES)[number];

const NODE_TYPES: readonly NodeType[] = [
  "project",
  "topic",
  "people",
  "daily",
  "capture",
  "custom",
];

const FOLDER_BY_TYPE: Record<NodeType, string> = {
  project: "projects",
  topic: "topics",
  people: "people",
  daily: "daily",
  capture: "captures",
  custom: "scratch",
};

const CREATED_AT = "2026-01-01T00:00:00.000Z";

export function parseGraphFixture(search: string): GraphFixtureSize | null {
  const raw = new URLSearchParams(search).get("graphFixture");
  if (raw === "500") return 500;
  if (raw === "2000") return 2000;
  return null;
}

export function graphFixtureId(size: GraphFixtureSize, index: number): string {
  return `perf-${size}-${String(index).padStart(4, "0")}`;
}

/**
 * A deterministic, connected graph for exercising the two performance
 * regimes around Loom's 500-node animation/drag budget. The ring and chord
 * edges keep ordinary neighborhoods representative; regular spokes into two
 * hubs make the large fixture reach the bounded drag-participant path.
 */
export function generateGraphFixture(size: GraphFixtureSize): Note[] {
  return Array.from({ length: size }, (_, index) => {
    const type = NODE_TYPES[index % NODE_TYPES.length]!;
    const targets = new Set<number>([(index + 1) % size, (index + 17) % size]);

    if (index > 0 && index % 8 === 0) targets.add(0);
    if (index > 1 && index % 37 === 0) targets.add(1);
    targets.delete(index);

    const suffix = String(index).padStart(4, "0");
    return {
      id: graphFixtureId(size, index),
      title: `Synthetic ${type} ${suffix}`,
      type,
      folder: FOLDER_BY_TYPE[type],
      tags: ["fixture", `bucket-${index % 10}`],
      body: `Deterministic ${size}-node graph fixture entry ${suffix}.`,
      links: [...targets].map((target) => graphFixtureId(size, target)),
      history: [{ action: "created", by: "you", at: CREATED_AT }],
      created: CREATED_AT,
      modified: CREATED_AT,
      status: "active",
      source: "synthetic-fixture",
    };
  });
}

import { describe, expect, it } from "vitest";
import {
  generateGraphFixture,
  graphFixtureId,
  parseGraphFixture,
  type GraphFixtureSize,
} from "./graphFixtures";

describe("parseGraphFixture", () => {
  it("accepts only the supported fixture sizes", () => {
    expect(parseGraphFixture("?graphFixture=500")).toBe(500);
    expect(parseGraphFixture("?demo=1&graphFixture=2000")).toBe(2000);
    expect(parseGraphFixture("?graphFixture=32")).toBeNull();
    expect(parseGraphFixture("?graphFixture=500.0")).toBeNull();
    expect(parseGraphFixture("?graphFixture=garbage")).toBeNull();
    expect(parseGraphFixture("")).toBeNull();
  });
});

describe.each([500, 2000] as const)("generateGraphFixture(%i)", (size) => {
  it("is deterministic, complete, and internally linked", () => {
    const first = generateGraphFixture(size);
    const second = generateGraphFixture(size);
    const ids = new Set(first.map((note) => note.id));

    expect(first).toEqual(second);
    expect(first).toHaveLength(size);
    expect(ids.size).toBe(size);
    expect(first[0]?.id).toBe(graphFixtureId(size, 0));

    for (const note of first) {
      expect(new Set(note.links).size).toBe(note.links.length);
      expect(note.links).not.toContain(note.id);
      for (const target of note.links) expect(ids.has(target)).toBe(true);
    }
  });

  it("distributes every node type and supplies stable hub spokes", () => {
    const notes = generateGraphFixture(size);
    const types = new Set(notes.map((note) => note.type));

    expect(types).toEqual(
      new Set(["project", "topic", "people", "daily", "capture", "custom"]),
    );
    expect(notes[8]?.links).toContain(graphFixtureId(size, 0));
    expect(notes[37]?.links).toContain(graphFixtureId(size, 1));
  });
});

it.each([
  [500, 1075],
  [2000, 4303],
] as const)(
  "the %i-node fixture has %i unique visual edges",
  (size, expected) => {
    const canonical = new Set<string>();
    for (const note of generateGraphFixture(size as GraphFixtureSize)) {
      for (const target of note.links) {
        canonical.add(
          note.id < target ? `${note.id}~${target}` : `${target}~${note.id}`,
        );
      }
    }
    expect(canonical.size).toBe(expected);
  },
);

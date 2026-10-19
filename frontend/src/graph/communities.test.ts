import { describe, expect, it } from "vitest";
import type { Note } from "@/data/types";
import { notes as seedNotes } from "@/data/notes";
import { detectCommunities } from "./communities";

const note = (id: string, links: string[] = [], title = id) =>
  ({
    id,
    title,
    links,
    type: "topic",
    folder: "topics",
    tags: [],
  }) as unknown as Note;

/** Two dense triangles joined by one bridge, plus a loose pair and a loner. */
const NOTES = [
  note("a1", ["a2", "a3"]),
  note("a2", ["a3"]),
  note("a3", ["b1"]),
  note("b1", ["b2", "b3"]),
  note("b2", ["b3"]),
  note("b3"),
  note("c1", ["c2"]),
  note("c2"),
  note("loner"),
];

describe("detectCommunities", () => {
  it("is deterministic", () => {
    const first = detectCommunities(NOTES);
    const second = detectCommunities([...NOTES].reverse());
    expect([...first.slotOf]).toEqual([...second.slotOf]);
    expect(first.communities).toEqual(second.communities);
  });

  it("groups densely linked notes and colors the largest first", () => {
    const { slotOf, communities } = detectCommunities(NOTES);
    expect(slotOf.get("a1")).toBe(slotOf.get("a2"));
    expect(slotOf.get("b1")).toBe(slotOf.get("b3"));
    expect(slotOf.get("a1")).not.toBe(slotOf.get("b1"));
    expect(communities.map((c) => c.size)).toEqual([3, 3, 2, 1]);
    expect(communities.at(-1)).toMatchObject({
      slot: null,
      label: "Other",
      size: 1,
    });
    expect(slotOf.get("loner")).toBeNull();
  });

  it("names a community after its most-linked note", () => {
    const { communities, slotOf } = detectCommunities(NOTES);
    const a = communities.find((c) => c.slot === slotOf.get("a1"))!;
    expect(a.label).toBe("a3"); // a3 links both triangle notes and the bridge
  });

  it("puts everything in Other when nothing links", () => {
    const { communities, slotOf } = detectCommunities([note("x"), note("y")]);
    expect(communities).toEqual([
      { slot: null, label: "Other", size: 2, anchorId: null },
    ]);
    expect(slotOf.get("x")).toBeNull();
  });

  it("caps colored communities at four on the demo vault", () => {
    const { communities } = detectCommunities(seedNotes);
    expect(
      communities.filter((c) => c.slot !== null).length,
    ).toBeLessThanOrEqual(4);
    expect(communities.reduce((n, c) => n + c.size, 0)).toBe(seedNotes.length);
  });
});

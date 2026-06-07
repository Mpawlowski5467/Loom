import { describe, it, expect } from "vitest";
import { structuralKey, contentKey } from "./graphKeys";
import type { Note } from "../data/types";

function mkNote(id: string, links: string[] = [], over: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    type: "topic",
    tags: [],
    folder: "topics",
    body: "",
    links,
    created: "",
    modified: "",
    author: "you",
    status: "active",
    history: [],
    ...over,
  } as Note;
}

describe("structuralKey", () => {
  it("is stable across note-array ordering", () => {
    const a = [mkNote("a", ["b"]), mkNote("b")];
    const b = [mkNote("b"), mkNote("a", ["b"])];
    expect(structuralKey(a)).toBe(structuralKey(b));
  });

  it("is unchanged when only content (title/tags/body) changes", () => {
    const before = [mkNote("a", ["b"]), mkNote("b")];
    const after = [
      mkNote("a", ["b"], { title: "Renamed", body: "new body", tags: ["x"] }),
      mkNote("b", [], { title: "Also renamed" }),
    ];
    expect(structuralKey(after)).toBe(structuralKey(before));
  });

  it("changes when a node is added", () => {
    const before = [mkNote("a")];
    const after = [mkNote("a"), mkNote("c")];
    expect(structuralKey(after)).not.toBe(structuralKey(before));
  });

  it("changes when a link is added", () => {
    const before = [mkNote("a"), mkNote("b")];
    const after = [mkNote("a", ["b"]), mkNote("b")];
    expect(structuralKey(after)).not.toBe(structuralKey(before));
  });

  it("treats a<->b and b<->a links as the same edge", () => {
    const ab = [mkNote("a", ["b"]), mkNote("b")];
    const ba = [mkNote("a"), mkNote("b", ["a"])];
    expect(structuralKey(ab)).toBe(structuralKey(ba));
  });
});

describe("contentKey", () => {
  it("is stable across ordering", () => {
    const a = [mkNote("a"), mkNote("b")];
    const b = [mkNote("b"), mkNote("a")];
    expect(contentKey(a)).toBe(contentKey(b));
  });

  it("changes when a title changes", () => {
    const before = [mkNote("a", [], { title: "Old" })];
    const after = [mkNote("a", [], { title: "New" })];
    expect(contentKey(after)).not.toBe(contentKey(before));
  });

  it("changes when a type changes", () => {
    const before = [mkNote("a", [], { type: "topic" })];
    const after = [mkNote("a", [], { type: "project" })];
    expect(contentKey(after)).not.toBe(contentKey(before));
  });

  it("does not change when only links change (that's structural)", () => {
    const before = [mkNote("a"), mkNote("b")];
    const after = [mkNote("a", ["b"]), mkNote("b")];
    expect(contentKey(after)).toBe(contentKey(before));
  });
});

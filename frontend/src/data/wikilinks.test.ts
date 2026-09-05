import { describe, expect, it } from "vitest";
import type { Note } from "./types";
import { buildWikilinkMap, linkTarget, wikilinkCandidates } from "./wikilinks";

const notes = [
  {
    id: "a",
    title: "Vault structure",
    folder: "topics",
    filename: "vault-structure.md",
    aliases: ["Layout"],
  },
  { id: "b", title: "Plan", folder: "projects/atlas", filename: "plan.md" },
  { id: "c", title: "Plan", folder: "projects/other", filename: "plan.md" },
] as Note[];

describe("canonical wikilinks", () => {
  it("resolves filenames, titles, aliases, IDs and nested paths with headings", () => {
    const map = buildWikilinkMap(notes);
    for (const key of [
      "Vault structure",
      "vault‑structure.md#Storage|Read",
      "Layout",
      "a",
      "topics/vault-structure",
    ])
      expect(map.get(linkTarget(key))).toBe("a");
    expect(map.get(linkTarget("projects/atlas/plan#Next steps"))).toBe("b");
  });
  it("keeps colliding names ambiguous and offers every candidate", () => {
    expect(buildWikilinkMap(notes).get("plan")).toBeUndefined();
    expect(
      wikilinkCandidates(notes, "Plan#Next").map((note) => note.id),
    ).toEqual(["b", "c"]);
  });
});

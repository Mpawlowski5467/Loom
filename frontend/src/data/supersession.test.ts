import { describe, expect, it } from "vitest";
import { buildWikilinkMap, linkTarget } from "./wikilinks";
import { supersessionSeed } from "./notesSupersession";
import {
  isSuperseded,
  supersededBy,
  supersessionOf,
  validFrom,
} from "./supersession";
import { extraProperties } from "./noteProperties";

const notes = supersessionSeed;
const map = buildWikilinkMap(notes);
const resolve = (raw: string) => map.get(linkTarget(raw));
const byId = (id: string) => notes.find((n) => n.id === id);
const [v1, v2, budget] = notes as [
  (typeof notes)[0],
  (typeof notes)[0],
  (typeof notes)[0],
];

describe("supersession", () => {
  it("reads status and valid-from", () => {
    expect(isSuperseded(v1)).toBe(true);
    expect(isSuperseded(v2)).toBe(false);
    expect(validFrom(v2)).toBe("2026-05-10");
    expect(validFrom(budget)).toBeNull();
  });

  it("finds what a note supersedes and when", () => {
    expect(supersessionOf(v2, resolve, byId)).toEqual({
      target: "cache-plan-v1",
      oldNote: v1,
      supersededAt: "2026-05-12",
    });
    expect(supersessionOf(budget, resolve, byId)).toBeNull();
  });

  it("keeps the banner when the old note is missing", () => {
    const orphan = { ...v2, extra: { supersedes: "[[gone]]" } };
    expect(supersessionOf(orphan, resolve, byId)).toMatchObject({
      target: "gone",
      oldNote: null,
    });
  });

  it("finds the replacement explicitly or by the newer note's claim", () => {
    expect(supersededBy(v1, notes, resolve)?.id).toBe("thr_p102");
    const implicit = { ...v1, extra: {} };
    expect(supersededBy(implicit, notes, resolve)?.id).toBe("thr_p102");
  });
});

describe("extraProperties", () => {
  it("lists base fields then other scalar frontmatter", () => {
    const keys = extraProperties(v2).map((p) => p.key);
    expect(keys.slice(0, 3)).toEqual(["type", "created", "modified"]);
    expect(keys).toContain("owner");
    // Shown elsewhere or internal:
    expect(keys).not.toContain("supersedes");
    expect(keys).not.toContain("valid_from");
    expect(keys).not.toContain("link_evidence");
  });
});

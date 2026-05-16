import type { NodeObject } from "react-force-graph-2d";
import { describe, expect, it } from "vitest";
import { getLinkId, type LoomLink, type LoomNode, nodeRadius } from "../types";

describe("nodeRadius", () => {
  it("returns base radius for zero links", () => {
    const node = { linkCount: 0 } as NodeObject<LoomNode>;
    expect(nodeRadius(node)).toBe(4);
  });

  it("scales with link count", () => {
    const node = { linkCount: 4 } as NodeObject<LoomNode>;
    expect(nodeRadius(node)).toBe(4 + 4 * 1.5);
  });

  it("treats undefined linkCount as zero", () => {
    const node = {} as NodeObject<LoomNode>;
    expect(nodeRadius(node)).toBe(4);
  });
});

describe("getLinkId", () => {
  it("handles string source and target", () => {
    const link: LoomLink = { source: "a", target: "b" };
    expect(getLinkId(link)).toEqual({ src: "a", tgt: "b" });
  });

  it("extracts id when source/target are node objects", () => {
    const link = {
      source: { id: "a" } as LoomNode,
      target: { id: "b" } as LoomNode,
    } as unknown as LoomLink;
    expect(getLinkId(link)).toEqual({ src: "a", tgt: "b" });
  });

  it("handles mixed object/string", () => {
    const link = {
      source: { id: "a" } as LoomNode,
      target: "b",
    } as unknown as LoomLink;
    expect(getLinkId(link)).toEqual({ src: "a", tgt: "b" });
  });
});

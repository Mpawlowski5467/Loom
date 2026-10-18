import { describe, expect, it } from "vitest";
import { CORPUS } from "./__fixtures__/corpus";
import { joinSourceLayout, splitSourceBlocks } from "./sourceBlocks";

describe("splitSourceBlocks", () => {
  it.each(Object.entries(CORPUS))("keeps every byte of %s", (_, md) => {
    expect(joinSourceLayout(splitSourceBlocks(md))).toBe(md);
  });

  it("splits top-level blocks", () => {
    const layout = splitSourceBlocks("# A\n\npara\n\n- x\n- y\n");
    expect(layout.blocks.map((b) => b.text)).toEqual([
      "# A",
      "para",
      "- x\n- y",
    ]);
    expect(layout.gaps).toEqual(["\n\n", "\n\n"]);
    expect(layout.trail).toBe("\n");
  });
});

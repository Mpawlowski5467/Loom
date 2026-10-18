import { describe, expect, it } from "vitest";
import { CORPUS } from "./__fixtures__/corpus";
import { joinSourceLayout, splitSourceBlocks } from "./sourceBlocks";

describe("splitSourceBlocks", () => {
  it.each(Object.entries(CORPUS))("keeps every byte of %s", (_, md) => {
    expect(joinSourceLayout(splitSourceBlocks(md))).toBe(md);
  });

  it("marks blocks the rich editor can't round-trip", () => {
    const layout = splitSourceBlocks(
      "Plain [[link]] and <kbd>Cmd</kbd>.\n\nSee [the guide][g].\n\n<div>raw</div>\n\n[g]: https://example.org\n\n```\n[ref][x]\n```\n",
    );
    expect(layout.blocks.map((b) => b.editable)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
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

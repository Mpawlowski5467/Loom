import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { remarkWikilink, splitWikilinks } from "./remarkWikilink";

const roundTrip = (md: string) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkWikilink)
      .use(remarkStringify, { bullet: "-" })
      .processSync(md),
  );

describe("remarkWikilink", () => {
  it("splits targets, aliases and headings", () => {
    expect(splitWikilinks("see [[a]] and [[b#Goals|the goals]].")).toEqual([
      { type: "text", value: "see " },
      { type: "wikilink", target: "a" },
      { type: "text", value: " and " },
      { type: "wikilink", target: "b#Goals", alias: "the goals" },
      { type: "text", value: "." },
    ]);
    expect(splitWikilinks("no links")).toEqual([]);
  });

  it("writes wikilinks back without escaping the brackets", () => {
    expect(
      roundTrip("Link [[cache-plan-v2]] and [[latency-budget|budget]].\n"),
    ).toBe("Link [[cache-plan-v2]] and [[latency-budget|budget]].\n");
  });

  it("leaves code alone", () => {
    expect(roundTrip("`[[not a link]]`\n")).toBe("`[[not a link]]`\n");
  });

  it("escapes the alias pipe inside table cells", () => {
    const md = "| Note |\n| - |\n| [[a\\|b]] |\n";
    expect(roundTrip(md)).toContain("[[a\\|b]]");
  });
});

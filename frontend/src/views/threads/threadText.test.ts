import { describe, expect, it } from "vitest";
import type { Note } from "@/data/types";
import { authorOf, summaryOf } from "./threadText";

describe("summaryOf", () => {
  it("prefers the text under a Summary heading", () => {
    expect(summaryOf("# Day\n\nIntro.\n\n## Summary\n\nA calm day.")).toBe(
      "A calm day.",
    );
  });

  it("takes the first paragraph, without markdown", () => {
    expect(
      summaryOf(
        "## morning\n\n- a list\n\nReviewing the [[Paper theme]] plan.",
      ),
    ).toBe("Reviewing the Paper theme plan.");
  });

  it("joins a list's items when the log has no paragraph", () => {
    expect(summaryOf("## wins\n\n- First thing.\n- [[Second]] thing")).toBe(
      "First thing; Second thing",
    );
  });

  it("skips frontmatter and truncates long text", () => {
    const text = summaryOf(`---\nid: x\n---\n${"word ".repeat(200)}`);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(421);
  });
});

describe("authorOf", () => {
  const base = { history: [], source: "manual" } as unknown as Note;

  it("names the agent that created the note", () => {
    expect(
      authorOf({
        ...base,
        history: [{ action: "created", by: "agent:scribe", at: "" }],
      }),
    ).toEqual({ id: "scribe", name: "Scribe" });
  });

  it("falls back to the source, and to you for manual notes", () => {
    expect(authorOf({ ...base, source: "agent:standup" }).name).toBe("Standup");
    expect(authorOf(base)).toEqual({ id: "you", name: "you" });
  });
});

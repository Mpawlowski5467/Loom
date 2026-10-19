import { describe, expect, it } from "vitest";
import type { CapturePreview } from "@/api/captures";
import type { Capture, Note } from "@/data/types";
import { captureMatchesFilter } from "./captureHelpers";
import { sourceLabel } from "./captureSource";
import { rowStatus } from "./captureStatus";
import { estimatePrecheck, proposedCommunity } from "./precheck";

const cap = (over: Partial<Capture> = {}) =>
  ({
    id: "c",
    title: "T",
    folder: "captures",
    body: "",
    receivedAt: "",
    status: "pending",
    ...over,
  }) as Capture;

describe("sourceLabel", () => {
  it.each([
    ["manual:clipper", "Web clip"],
    ["bridge:gmail", "Email"],
    ["bridge:email", "Email"],
    ["mcp:claude", "MCP"],
    ["bridge:telegram", "Telegram"],
    ["bridge:outlook-cal", "Calendar"],
    ["bridge:github", "GitHub"],
    ["manual:pdf", "PDF"],
    ["manual:quick-capture", "Manual"],
    ["agent:researcher", "Researcher"],
    [undefined, "Manual"],
    ["something:else", "something:else"],
  ])("labels %s as %s", (source, label) => {
    expect(sourceLabel(source)).toBe(label);
  });
});

describe("rowStatus and filters", () => {
  it("prefers the job's state and marks ready proposals", () => {
    expect(rowStatus(cap(), undefined, false)).toBe("new");
    expect(rowStatus(cap(), undefined, true)).toBe("proposal");
    expect(rowStatus(cap(), { status: "running" } as never, true)).toBe(
      "processing",
    );
    expect(rowStatus(cap({ status: "needs_review" }), undefined, false)).toBe(
      "review",
    );
    expect(rowStatus(cap({ status: "done" }), undefined, false)).toBe("filed");
  });

  it("sorts captures into All, Needs review and Filed", () => {
    const review = cap({ status: "needs_review" });
    const failedJob = { status: "failed" } as never;
    expect(captureMatchesFilter(review, undefined, "review")).toBe(true);
    expect(captureMatchesFilter(cap(), failedJob, "review")).toBe(true);
    expect(captureMatchesFilter(cap(), undefined, "review")).toBe(false);
    expect(
      captureMatchesFilter(cap({ status: "done" }), undefined, "filed"),
    ).toBe(true);
    expect(captureMatchesFilter(cap(), undefined, "all")).toBe(true);
  });
});

describe("estimatePrecheck", () => {
  const preview: CapturePreview = {
    note_type: "topic",
    folder: "topics",
    title: "Caching",
    tags: [],
    body: "",
    links: [],
    source_coverage: { complete: false },
  };
  const notes = [
    { title: "Caching", folder: "topics", status: "active" },
  ] as Note[];

  it("flags a title clash, no tags or links, a duplicate and an oversized source", () => {
    const items = estimatePrecheck(preview, notes, [
      {
        note_id: "n",
        title: "Caching basics",
        score: 0.8,
        title_overlap: [],
        body_overlap: [],
        rationale: "",
      },
    ]);
    expect(items.map((i) => [i.rule, i.status])).toEqual([
      ["Title", "warn"],
      ["Folder", "pass"],
      ["Tags", "warn"],
      ["Links", "warn"],
      ["Duplicates", "warn"],
      ["Source", "warn"],
    ]);
  });

  it("passes a clean proposal and notes a new folder", () => {
    const items = estimatePrecheck(
      {
        ...preview,
        title: "Fresh",
        folder: "research",
        tags: ["x"],
        links: [
          { note_id: "a", title: "A", score: 1, decision: "auto-linked" },
        ],
        source_coverage: undefined,
      },
      notes,
      [],
    );
    expect(items.map((i) => i.status)).toEqual([
      "pass",
      "warn",
      "pass",
      "pass",
    ]);
    expect(items[1]!.message).toBe("Creates a new folder, research/.");
  });
});

describe("proposedCommunity", () => {
  it("picks the community most links belong to", () => {
    const slots = new Map<string, number | null>([
      ["a", 1],
      ["b", 1],
      ["c", 0],
      ["d", null],
    ]);
    expect(proposedCommunity(["a", "b", "c", "d"], slots)).toBe(1);
    expect(proposedCommunity(["d"], slots)).toBeNull();
  });
});

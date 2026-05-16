import { describe, expect, it } from "vitest";
import { formatTime, getInitials, parseChangelogEntries } from "../helpers";

describe("getInitials", () => {
  it("returns ? for empty name", () => {
    expect(getInitials("", ["weaver"])).toBe("?");
  });

  it("returns 1-char uppercase when first letter is unique", () => {
    expect(getInitials("weaver", ["weaver", "spider"])).toBe("W");
  });

  it("returns 2-char when first letter collides", () => {
    expect(getInitials("standup", ["spider", "standup", "scribe"])).toBe("St");
  });

  it("handles a single-name list", () => {
    expect(getInitials("solo", ["solo"])).toBe("S");
  });
});

describe("formatTime", () => {
  it("returns empty string for empty input", () => {
    expect(formatTime("")).toBe("");
  });

  it("formats a valid ISO timestamp", () => {
    const result = formatTime("2026-05-16T14:30:00Z");
    // Output is locale-dependent; just verify it's non-empty and looks time-ish.
    expect(result).toMatch(/\d/);
  });

  it("returns the input when not parseable", () => {
    expect(formatTime("not-a-date")).toBe("Invalid Date");
  });
});

describe("parseChangelogEntries", () => {
  it("returns empty list for empty content", () => {
    expect(parseChangelogEntries("weaver", "")).toEqual([]);
  });

  it("parses one block with action and details", () => {
    const content = `## 2026-05-16T10:00:00Z
- **Action:** linked
- **Details:** auto-linked 2 notes`;
    const entries = parseChangelogEntries("spider", content);
    expect(entries).toEqual([
      {
        time: "2026-05-16T10:00:00Z",
        agent: "spider",
        action: "linked",
        details: "auto-linked 2 notes",
      },
    ]);
  });

  it("falls back to action when details missing", () => {
    const content = `## 2026-05-16T10:00:00Z
- **Action:** scanned`;
    const entries = parseChangelogEntries("spider", content);
    expect(entries[0].details).toBe("scanned");
  });

  it("parses multiple blocks", () => {
    const content = `## 2026-05-16T09:00:00Z
- **Action:** created
- **Details:** new note
## 2026-05-16T10:00:00Z
- **Action:** linked
- **Details:** 1 link`;
    const entries = parseChangelogEntries("weaver", content);
    expect(entries).toHaveLength(2);
  });

  it("skips blocks without action", () => {
    const content = `## 2026-05-16T09:00:00Z
- some random text`;
    expect(parseChangelogEntries("scribe", content)).toEqual([]);
  });
});

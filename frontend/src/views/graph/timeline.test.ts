import { describe, expect, it } from "vitest";
import type { Note } from "@/data/types";
import { dayCount, dayToTime, timeToDay, timelineRange } from "./timeline";

const at = (created: string) => ({ created }) as Note;
const DAY = 86_400_000;

describe("timeline", () => {
  it("runs from the first note's day to the end of today", () => {
    const now = Date.parse("2026-06-10T15:00:00Z");
    const range = timelineRange(
      [at("2026-06-03T09:00:00Z"), at("2026-06-01T20:00:00Z"), at("junk")],
      now,
    )!;
    expect(new Date(range.start).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(new Date(range.end).toISOString()).toBe("2026-06-11T00:00:00.000Z");
    expect(dayCount(range)).toBe(10);
  });

  it("has no range without a dated note", () => {
    expect(timelineRange([at("")])).toBeNull();
    expect(timelineRange([])).toBeNull();
  });

  it("maps days to times and back", () => {
    const range = { start: 0, end: 10 * DAY };
    expect(dayToTime(range, 3)).toBe(3 * DAY);
    expect(timeToDay(range, 3 * DAY + 1000)).toBe(3);
  });
});

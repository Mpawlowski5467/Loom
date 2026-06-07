import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatMonthDay,
  formatTime,
  formatDateTime,
} from "./formatDate";

const ISO = "2026-06-07T14:32:09Z";

describe("formatDate utils", () => {
  it("formats a valid ISO timestamp into each shape (UTC)", () => {
    expect(formatDate(ISO)).toBe("2026-06-07");
    expect(formatMonthDay(ISO)).toBe("06-07");
    expect(formatTime(ISO)).toBe("14:32");
    expect(formatDateTime(ISO)).toBe("06-07 14:32");
  });

  it("returns an em dash for an empty string", () => {
    expect(formatDate("")).toBe("—");
    expect(formatMonthDay("")).toBe("—");
    expect(formatTime("")).toBe("—");
    expect(formatDateTime("")).toBe("—");
  });

  it("returns an em dash for undefined / null", () => {
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate(null)).toBe("—");
  });

  it("returns an em dash for an unparseable string", () => {
    expect(formatDate("not a date")).toBe("—");
    expect(formatDateTime("garbage")).toBe("—");
  });

  it("normalises a date-only ISO value", () => {
    // A date-only string parses as UTC midnight.
    expect(formatDate("2026-01-15")).toBe("2026-01-15");
    expect(formatTime("2026-01-15")).toBe("00:00");
  });
});

import type { Note } from "@/data/types";
import { createdAt } from "@/graph/nodeFilter";

const DAY = 24 * 60 * 60 * 1000;

export interface TimelineRange {
  start: number;
  end: number;
}

/** From the first note's creation date to the end of today. */
export function timelineRange(
  notes: readonly Note[],
  now = Date.now(),
): TimelineRange | null {
  let first = Infinity;
  for (const n of notes) {
    const t = createdAt(n);
    if (Number.isFinite(t) && t < first) first = t;
  }
  if (!Number.isFinite(first)) return null;
  const end = Math.ceil(now / DAY) * DAY;
  return {
    start: Math.floor(first / DAY) * DAY,
    end: Math.max(end, first + DAY),
  };
}

/** Slider steps are whole days. */
export function dayCount(range: TimelineRange): number {
  return Math.round((range.end - range.start) / DAY);
}

export function dayToTime(range: TimelineRange, day: number): number {
  return range.start + day * DAY;
}

export function timeToDay(range: TimelineRange, time: number): number {
  return Math.round((time - range.start) / DAY);
}

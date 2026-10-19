import { localDate } from "./threadModel";

/** A YYYY-MM-DD date at local midnight. */
function at(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

/** "Saturday, May 16, 2026". */
export function longDate(date: string): string {
  const d = at(date);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
}

/** "Sat, May 16", with the year when it isn't this year. */
export function shortDate(date: string, now = new Date()): string {
  const d = at(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}

/** One- or three-letter weekday for the chart axis. */
export function weekday(date: string, style: "short" | "long"): string {
  const d = at(date);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { weekday: style });
}

/** Time of day, plus the date when it isn't `date`: "09:12" or "May 17, 09:12". */
export function stampLabel(iso: string, date: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (localDate(d) === date) return time;
  const day = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${day}, ${time}`;
}

export const isToday = (date: string, now = new Date()) =>
  date === localDate(now);

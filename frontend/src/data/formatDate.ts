/**
 * Date formatters for vault timestamps. The backend permits empty/missing
 * timestamps (e.g. ``created`` falling back to ``""``), so every formatter
 * guards against invalid input and returns an em dash rather than rendering a
 * blank or garbled positional slice. Mirrors the Date.parse + isNaN convention
 * already used by boardHelpers' formatRelativeTime.
 *
 * Formatting reads the canonical ISO string (UTC), preserving the prior
 * positional-slice display rather than shifting to the viewer's local zone —
 * the only behavioural change here is that invalid input degrades to "—".
 */

const PLACEHOLDER = "—";

/** Normalise input to a valid ISO string, or null when unparseable/empty. */
function toIso(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

/** Date only, e.g. "2026-06-07". */
export function formatDate(iso: string | undefined | null): string {
  const v = toIso(iso);
  return v ? v.slice(0, 10) : PLACEHOLDER;
}

/** Month-day, e.g. "06-07". */
export function formatMonthDay(iso: string | undefined | null): string {
  const v = toIso(iso);
  return v ? v.slice(5, 10) : PLACEHOLDER;
}

/** Time of day, e.g. "14:32". */
export function formatTime(iso: string | undefined | null): string {
  const v = toIso(iso);
  return v ? v.slice(11, 16) : PLACEHOLDER;
}

/** Month-day and time, e.g. "06-07 14:32". */
export function formatDateTime(iso: string | undefined | null): string {
  const v = toIso(iso);
  return v ? `${v.slice(5, 10)} ${v.slice(11, 16)}` : PLACEHOLDER;
}

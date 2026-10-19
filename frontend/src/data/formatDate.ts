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

/** "45s ago", "12m ago", "3h ago", "2d ago"; the input when unparseable. */
export function formatRelative(iso: string | undefined | null): string {
  if (!iso) return PLACEHOLDER;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

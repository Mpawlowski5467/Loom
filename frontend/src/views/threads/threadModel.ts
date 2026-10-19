import { isSuperseded } from "@/data/supersession";
import type { AgentEvent, Capture, Note } from "@/data/types";
import { plainText } from "@/editor/plainText";

/** YYYY-MM-DD in the viewer's local time. */
export function localDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^\d{2}:\d{2}(:\d{2})?$/;

/** An event's local day. Time-only stamps (demo seed) count as today. */
export function eventDay(ts: string, now = new Date()): string {
  return TIME_ONLY.test(ts) ? localDate(now) : localDate(ts);
}

export interface DailyThread {
  kind: "daily";
  id: string;
  date: string;
  note: Note;
  /** Notes created that day. */
  count: number;
}

export interface StandupThread {
  kind: "standup";
  id: string;
  date: string;
  title: string;
  body: string;
  note?: Note;
  capture?: Capture;
}

export interface CouncilThreadRef {
  kind: "council";
  id: string;
  date: string;
}

export type ThreadItem = DailyThread | StandupThread | CouncilThreadRef;

/** Scribe's daily logs, newest first, with how many notes each day made. */
export function dailyThreads(notes: readonly Note[]): DailyThread[] {
  const created = new Map<string, number>();
  for (const n of notes)
    if (n.type !== "daily" && n.status !== "archived") {
      const d = localDate(n.created);
      created.set(d, (created.get(d) ?? 0) + 1);
    }
  return notes
    .filter((n) => n.type === "daily" && n.status !== "archived")
    .map((note) => {
      const date = DATE_RE.test(note.title)
        ? note.title
        : localDate(note.created);
      return {
        kind: "daily" as const,
        id: date,
        date,
        note,
        count: created.get(date) ?? 0,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Standup recaps: captures still in the Inbox and filed notes. */
export function standupThreads(
  notes: readonly Note[],
  captures: readonly Capture[],
): StandupThread[] {
  const seen = new Set<string>();
  const out: StandupThread[] = [];
  for (const c of captures)
    if (c.source === "agent:standup" && c.status !== "done") {
      seen.add(c.title);
      out.push({
        kind: "standup",
        id: `standup-${c.id}`,
        date: localDate(c.receivedAt),
        title: c.title,
        body: c.body,
        capture: c,
      });
    }
  for (const n of notes)
    if (
      n.type !== "daily" &&
      n.status !== "archived" &&
      n.tags.includes("standup") &&
      !seen.has(n.title)
    )
      out.push({
        kind: "standup",
        id: `standup-${n.id}`,
        date: localDate(n.created),
        title: n.title,
        body: n.body,
        note: n,
      });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export const councilThread = (date: string): CouncilThreadRef => ({
  kind: "council",
  id: `council-${date}`,
  date,
});

export interface DigestRow {
  key: string;
  text: string;
  meta: string;
  /** Community slot for the dot; null draws the neutral dot. */
  slot: number | null;
  noteId?: string;
}

export interface DayDigest {
  newNotes: DigestRow[];
  flags: DigestRow[];
  links: DigestRow[];
}

function time(iso: string): string {
  if (TIME_ONLY.test(iso)) return iso.slice(0, 5);
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The note an event's target names (its first wikilink, else a path). */
function targetMatcher(
  notes: readonly Note[],
  slotOf: ReadonlyMap<string, number | null>,
): (target: string) => Pick<DigestRow, "slot" | "noteId"> {
  const byName = new Map<string, Note>();
  for (const n of notes) {
    byName.set(n.title.toLowerCase(), n);
    if (n.filename)
      byName.set(n.filename.replace(/\.md$/, "").toLowerCase(), n);
  }
  return (target) => {
    const wiki = /\[\[([^\]|]+)/.exec(target)?.[1];
    const raw = wiki ?? target.trim().split(/\s/)[0] ?? "";
    const name = raw.replace(/\.md$/, "").split("/").pop() ?? "";
    const note = byName.get(name.toLowerCase());
    return note
      ? { slot: slotOf.get(note.id) ?? null, noteId: note.id }
      : { slot: null };
  };
}

/**
 * One day's New notes / Flags / Links, derived from loaded notes, captures
 * and the changelog window (backend gap 12: there's no structured summary).
 */
export function dayDigest(
  date: string,
  notes: readonly Note[],
  captures: readonly Capture[],
  events: readonly AgentEvent[],
  slotOf: ReadonlyMap<string, number | null>,
  now = new Date(),
): DayDigest {
  const match = targetMatcher(notes, slotOf);
  const day = events.filter((e) => eventDay(e.ts, now) === date);
  const text = (e: AgentEvent) => plainText(`${e.action} ${e.target}`);
  return {
    newNotes: notes
      .filter(
        (n) =>
          n.type !== "daily" &&
          n.status !== "archived" &&
          localDate(n.created) === date,
      )
      .sort((a, b) => a.created.localeCompare(b.created))
      .map((n) => ({
        key: n.id,
        text: n.title,
        meta: time(n.created),
        slot: slotOf.get(n.id) ?? null,
        noteId: n.id,
      })),
    flags: [
      ...day
        .filter((e) => e.sentinel !== "ok")
        .map((e) => ({
          key: e.id,
          text: text(e),
          meta: e.sentinel === "warn" ? "warning" : "failed",
          ...match(e.target),
        })),
      ...captures
        .filter(
          (c) =>
            localDate(c.receivedAt) === date &&
            (c.status === "needs_review" || c.reviewRequired === true),
        )
        .map((c) => ({
          key: c.id,
          text: c.title,
          meta: "capture to review",
          slot: null,
        })),
    ],
    links: day
      .filter((e) => e.agent === "spider" && /link/i.test(e.action))
      .map((e) => ({
        key: e.id,
        text: text(e),
        meta: time(e.ts),
        ...match(e.target),
      })),
  };
}

/** Agent actions per day for the 7 days ending today (oldest first). */
export function actionsPerDay(
  events: readonly AgentEvent[],
  now = new Date(),
): { date: string; count: number }[] {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return localDate(d);
  });
  const counts = new Map(days.map((d) => [d, 0]));
  for (const e of events) {
    const d = eventDay(e.ts, now);
    if (counts.has(d)) counts.set(d, counts.get(d)! + 1);
  }
  return days.map((date) => ({ date, count: counts.get(date)! }));
}

export interface VaultStats {
  notes: number;
  links: number;
  superseded: number;
  /** Agent actions you reverted within the changelog window. */
  undone: number;
}

/** Vault stats from loaded notes and the changelog window (gap 13). */
export function vaultStats(
  notes: readonly Note[],
  events: readonly AgentEvent[],
): VaultStats {
  const live = notes.filter((n) => n.status !== "archived");
  const ids = new Set(live.map((n) => n.id));
  const pairs = new Set<string>();
  for (const n of live)
    for (const t of n.links)
      if (t !== n.id && ids.has(t))
        pairs.add(n.id < t ? `${n.id}|${t}` : `${t}|${n.id}`);
  return {
    notes: live.length,
    links: pairs.size,
    superseded: live.filter(isSuperseded).length,
    undone: events.filter((e) => e.reverted).length,
  };
}

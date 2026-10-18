import type { Note } from "@/data/types";

/**
 * What the graph shows. Each criterion narrows the visible set; the defaults
 * show every note except superseded ones.
 */
export interface GraphNodeFilter {
  /** Only notes in this folder (or below it). */
  folder: string | null;
  /** Only notes in this community slot (0–3), or "other" for the rest. */
  community: number | "other" | null;
  /** Superseded notes are hidden unless this is on. */
  showSuperseded: boolean;
  /** Timeline: hide notes created after this instant (epoch ms). */
  createdBefore: number | null;
}

export const DEFAULT_NODE_FILTER: GraphNodeFilter = {
  folder: null,
  community: null,
  showSuperseded: false,
  createdBefore: null,
};

/** Node attributes the filter reads (set when nodes are built/synced). */
export interface FilterableAttributes {
  folder?: unknown;
  community?: unknown;
  superseded?: unknown;
  created?: unknown;
}

function inFolder(folder: string, filter: string): boolean {
  return folder === filter || folder.startsWith(`${filter}/`);
}

/** The filter test on graph node attributes (render path). */
export function nodePassesFilter(
  attrs: FilterableAttributes,
  filter: GraphNodeFilter,
): boolean {
  if (!filter.showSuperseded && attrs.superseded === true) return false;
  if (
    filter.folder !== null &&
    !inFolder(String(attrs.folder ?? ""), filter.folder)
  )
    return false;
  if (filter.community !== null) {
    const slot = attrs.community ?? null;
    if (
      filter.community === "other" ? slot !== null : slot !== filter.community
    )
      return false;
  }
  if (filter.createdBefore !== null) {
    const created = typeof attrs.created === "number" ? attrs.created : NaN;
    if (Number.isFinite(created) && created > filter.createdBefore)
      return false;
  }
  return true;
}

/** Epoch ms of a note's creation; NaN when it has no usable date. */
export function createdAt(note: Pick<Note, "created">): number {
  return Date.parse(note.created);
}

/** The same test on a note, for counts computed outside the graph. */
export function notePassesFilter(
  note: Note,
  filter: GraphNodeFilter,
  slotOf: ReadonlyMap<string, number | null>,
): boolean {
  return nodePassesFilter(
    {
      folder: note.folder,
      community: slotOf.get(note.id) ?? null,
      superseded: note.status === "superseded",
      created: createdAt(note),
    },
    filter,
  );
}

/** Whether the filter narrows anything beyond the superseded default. */
export function filterIsNarrowed(filter: GraphNodeFilter): boolean {
  return (
    filter.folder !== null ||
    filter.community !== null ||
    filter.createdBefore !== null
  );
}

/** Stable string for effect dependencies. */
export function filterKey(filter: GraphNodeFilter): string {
  return [
    filter.folder ?? "",
    filter.community ?? "",
    filter.showSuperseded ? "s" : "",
    filter.createdBefore ?? "",
  ].join("|");
}

/** Validate a persisted filter; the timeline cutoff is never restored. */
export function sanitizeNodeFilter(value: unknown): GraphNodeFilter {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const community =
    v.community === "other"
      ? "other"
      : typeof v.community === "number" &&
          Number.isInteger(v.community) &&
          v.community >= 0 &&
          v.community < 4
        ? v.community
        : null;
  return {
    folder: typeof v.folder === "string" && v.folder.trim() ? v.folder : null,
    community,
    showSuperseded: v.showSuperseded === true,
    createdBefore: null,
  };
}

import type { DuplicateEvidence } from "@/api/captureReview";
import type { CapturePreview } from "@/api/captures";
import type { PrecheckItem } from "@/api/proposals";
import type { Note } from "@/data/types";

const CORE = new Set(["daily", "projects", "topics", "people", "captures"]);

/**
 * A pre-check estimated in the browser from Weaver's preview, for when the
 * backend has no stored one (gap 11). Sentinel still validates on filing;
 * this only flags what's visible up front, so nothing here "fails".
 */
export function estimatePrecheck(
  preview: CapturePreview,
  notes: readonly Note[],
  duplicates: readonly DuplicateEvidence[],
): PrecheckItem[] {
  const title = preview.title.trim().toLowerCase();
  const sameTitle = notes.find(
    (n) => n.status !== "archived" && n.title.trim().toLowerCase() === title,
  );
  const folders = new Set(notes.map((n) => n.folder.split("/")[0]));
  const top = preview.folder.split("/")[0] ?? "";
  const coverage = preview.source_coverage as
    | { complete?: boolean }
    | undefined;
  const items: PrecheckItem[] = [
    sameTitle
      ? {
          rule: "Title",
          status: "warn",
          message: `A note called "${sameTitle.title}" already exists.`,
        }
      : {
          rule: "Title",
          status: "pass",
          message: "No other note has this title.",
        },
    CORE.has(top) || folders.has(top)
      ? {
          rule: "Folder",
          status: "pass",
          message: `Files into ${preview.folder}/.`,
        }
      : {
          rule: "Folder",
          status: "warn",
          message: `Creates a new folder, ${preview.folder}/.`,
        },
    preview.tags.length > 0
      ? {
          rule: "Tags",
          status: "pass",
          message: `${preview.tags.length} tag${preview.tags.length === 1 ? "" : "s"}.`,
        }
      : { rule: "Tags", status: "warn", message: "No tags." },
    preview.links.length > 0
      ? {
          rule: "Links",
          status: "pass",
          message: `Spider found ${preview.links.length} link${preview.links.length === 1 ? "" : "s"}.`,
        }
      : {
          rule: "Links",
          status: "warn",
          message: "No links; it would start unconnected.",
        },
  ];
  if (duplicates.length > 0)
    items.push({
      rule: "Duplicates",
      status: "warn",
      message: `Close to "${duplicates[0]!.title}".`,
    });
  if (coverage?.complete === false)
    items.push({
      rule: "Source",
      status: "warn",
      message: "Larger than Weaver's extraction limit; the original is kept.",
    });
  return items;
}

/** The community most of the proposed links belong to, if any. */
export function proposedCommunity(
  linkIds: readonly string[],
  slotOf: ReadonlyMap<string, number | null>,
): number | null {
  const counts = new Map<number, number>();
  for (const id of linkIds) {
    const slot = slotOf.get(id);
    if (slot != null) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [slot, n] of counts)
    if (best === null || n > counts.get(best)!) best = slot;
  return best;
}

import type { Note } from "@/data/types";
import type { NoteFinding } from "../findings";
import { mockDelay } from "./index";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Plausible Archivist findings derived from the note itself, so the card
 * shows on some notes and not others.
 */
export function mockNoteFindings(note: Note): Promise<NoteFinding[]> {
  const findings: NoteFinding[] = [];
  const created = new Date(Date.now() - 2 * DAY).toISOString();
  const age = Date.now() - Date.parse(note.modified);
  if (note.type !== "daily" && age > 120 * DAY)
    findings.push({
      agent: "archivist",
      kind: "stale",
      message: `Not updated in ${Math.floor(age / DAY)} days. Check it still holds, or mark it superseded.`,
      created,
    });
  if (note.type !== "daily" && note.links.length === 0)
    findings.push({
      agent: "archivist",
      kind: "orphan",
      message: "No other note links here, and it links to nothing.",
      created,
    });
  return mockDelay(findings);
}

import type { Note } from "@/data/types";
import { plainText } from "@/editor/plainText";

const SUMMARY_LIMIT = 420;

const HEADING = /^#{1,6}\s/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** A block as one line; list items are joined with semicolons. */
function blockText(block: string): string {
  const lines = block.split("\n");
  if (!lines.every((l) => LIST_ITEM.test(l) || /^\s/.test(l)))
    return plainText(block);
  return lines
    .filter((l) => LIST_ITEM.test(l))
    .map((l) => plainText(l).replace(/[.;]$/, ""))
    .join("; ");
}

/**
 * The log's summary paragraph: the text under a "Summary" heading when
 * there is one, else the first paragraph, else the first list.
 */
export function summaryOf(body: string): string {
  const blocks = body
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const heading = blocks.findIndex((b) => /^#{1,6}\s+summary\b/i.test(b));
  const content = blocks.filter((b) => !HEADING.test(b));
  const block =
    heading >= 0
      ? blocks[heading + 1]
      : (content.find((b) => !LIST_ITEM.test(b)) ?? content[0]);
  const text = block ? blockText(block) : "";
  return text.length > SUMMARY_LIMIT
    ? `${text.slice(0, SUMMARY_LIMIT).trimEnd()}…`
    : text;
}

export interface Author {
  /** "you", or an agent id like "scribe". */
  id: string;
  name: string;
}

/** Who wrote a note: its "created" history entry, else author or source. */
export function authorOf(note: Note): Author {
  const created = note.history.find((h) => h.action === "created")?.by;
  const raw = (created ?? note.author ?? note.source ?? "").trim();
  if (!raw || raw === "you" || raw === "human" || raw === "manual")
    return { id: "you", name: "you" };
  const id = raw.replace(/^agent:/, "").toLowerCase();
  return { id, name: id.charAt(0).toUpperCase() + id.slice(1) };
}

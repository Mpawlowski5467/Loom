import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** One top-level markdown block and its exact source text. */
export interface SourceBlock {
  text: string;
  start: number;
  end: number;
}

export interface SourceLayout {
  /** Whitespace before the first block. */
  lead: string;
  blocks: SourceBlock[];
  /** gaps[i] is the source between blocks[i] and blocks[i + 1]. */
  gaps: string[];
  /** Whitespace (usually a newline) after the last block. */
  trail: string;
}

const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * Split markdown into its top-level blocks (paragraphs, headings, lists,
 * code, tables, …) keeping every byte, so the source can be rebuilt exactly
 * from `lead + blocks/gaps + trail`.
 */
export function splitSourceBlocks(markdown: string): SourceLayout {
  const root = parser.parse(markdown);
  const blocks: SourceBlock[] = [];
  for (const node of root.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    blocks.push({ text: markdown.slice(start, end), start, end });
  }
  if (blocks.length === 0)
    return { lead: "", blocks: [], gaps: [], trail: markdown };
  const gaps = blocks
    .slice(1)
    .map((b, i) => markdown.slice(blocks[i]!.end, b.start));
  return {
    lead: markdown.slice(0, blocks[0]!.start),
    blocks,
    gaps,
    trail: markdown.slice(blocks[blocks.length - 1]!.end),
  };
}

/** Rebuild the original source from a layout (round-trip check). */
export function joinSourceLayout(layout: SourceLayout): string {
  let out = layout.lead;
  layout.blocks.forEach((b, i) => {
    out += b.text;
    if (i < layout.gaps.length) out += layout.gaps[i];
  });
  return out + layout.trail;
}

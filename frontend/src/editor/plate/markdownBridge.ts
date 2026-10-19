import { MarkdownPlugin } from "@platejs/markdown";
import type { Descendant, SlateEditor, TElement, Value } from "platejs";
import {
  splitSourceBlocks,
  type SourceLayout,
} from "@/editor/markdown/sourceBlocks";
import { MD_RAW } from "./rawMarkdown";

/**
 * Lossless markdown ↔ Plate bridge.
 *
 * Each top-level markdown block is deserialized on its own and its nodes
 * are tagged with the block's index. On serialize, a run of nodes that
 * still equals what its block deserialized to is written back as the
 * block's original source, byte for byte; only edited blocks go through
 * Plate's serializer. So opening (or undoing every edit to) a note never
 * rewrites it, and an edit reformats only the block it touched.
 */

const BLOCK = "_mdBlock";

type Tagged = TElement & { [BLOCK]?: number };

export interface LoadedNote {
  markdown: string;
  layout: SourceLayout;
  value: Value;
}

/** Deserialize note markdown into a tagged Plate value. */
export function loadNote(editor: SlateEditor, markdown: string): LoadedNote {
  const layout = splitSourceBlocks(markdown);
  const api = editor.getApi(MarkdownPlugin).markdown;
  const value = layout.blocks.flatMap((block, i): Tagged[] => {
    // Top-level markdown always deserializes to elements.
    const nodes = (
      block.editable ? api.deserialize(block.text, { withoutMdx: true }) : []
    ) as TElement[];
    if (nodes.length === 0)
      return [
        {
          type: MD_RAW,
          source: block.text,
          children: [{ text: "" }],
          [BLOCK]: i,
        },
      ];
    return nodes.map((n) => ({ ...n, [BLOCK]: i }));
  });
  return {
    markdown,
    layout,
    value: value.length ? value : [{ type: "p", children: [{ text: "" }] }],
  };
}

/** Node ids (from Plate's nodeId plugin) don't count as content. */
function contentKey(nodes: readonly Descendant[]): string {
  return JSON.stringify(nodes, (key, v) => (key === "id" ? undefined : v));
}

/** Per-block content as loaded into the editor, to detect edits. */
export interface Baseline {
  doc: string;
  blocks: Map<number, string>;
}

export function captureBaseline(nodes: readonly Descendant[]): Baseline {
  const groups = new Map<number, Descendant[]>();
  for (const n of nodes as Tagged[]) {
    const blk = n[BLOCK];
    if (blk === undefined) continue;
    groups.set(blk, [...(groups.get(blk) ?? []), n]);
  }
  return {
    doc: contentKey(nodes),
    blocks: new Map([...groups].map(([k, g]) => [k, contentKey(g)])),
  };
}

interface Part {
  text: string;
  /** Source block index, when this part is that block unchanged. */
  block: number | null;
}

/** Serialize the editor value back to markdown, preserving untouched blocks. */
export function saveNote(
  editor: SlateEditor,
  loaded: LoadedNote,
  baseline: Baseline,
  nodes: readonly Descendant[] = editor.children,
): string {
  if (contentKey(nodes) === baseline.doc) return loaded.markdown;
  const { layout } = loaded;
  const api = editor.getApi(MarkdownPlugin).markdown;

  // Consecutive nodes from the same source block form a run.
  const runs: Tagged[][] = [];
  for (const n of nodes as Tagged[]) {
    const last = runs[runs.length - 1];
    if (last && last[0]![BLOCK] === n[BLOCK]) last.push(n);
    else runs.push([n]);
  }

  const parts: Part[] = runs
    .map((run): Part => {
      const blk = run[0]![BLOCK];
      if (blk !== undefined && baseline.blocks.get(blk) === contentKey(run))
        return { text: layout.blocks[blk]!.text, block: blk };
      const value = run.map((n) => {
        const node = { ...n };
        delete node[BLOCK];
        return node as Descendant;
      });
      return {
        text: api
          .serialize({ value, preserveEmptyParagraphs: false })
          .replace(/\n+$/, ""),
        block: null,
      };
    })
    .filter((p) => p.text !== "");

  if (parts.length === 0) return "";
  let out = parts[0]!.block === 0 ? layout.lead : "";
  parts.forEach((part, k) => {
    if (k > 0) {
      const prev = parts[k - 1]!;
      const adjacent = prev.block !== null && part.block === prev.block + 1;
      out += adjacent ? layout.gaps[prev.block!] : "\n\n";
    }
    out += part.text;
  });
  const last = parts[parts.length - 1]!;
  if (last.block === layout.blocks.length - 1) out += layout.trail;
  else if (/\n\s*$/.test(loaded.markdown) || loaded.markdown === "")
    out += "\n";
  return out;
}

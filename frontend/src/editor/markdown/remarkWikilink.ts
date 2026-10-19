import type { Parents, Root, Text } from "mdast";
import type { Node } from "unist";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";

/** mdast node for `[[target|alias]]`; target may carry `#heading`. */
export interface WikilinkNode extends Node {
  type: "wikilink";
  target: string;
  alias?: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    wikilink: WikilinkNode;
  }
  interface RootContentMap {
    wikilink: WikilinkNode;
  }
}

const WIKILINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;

/** Split plain text into text and wikilink nodes. */
export function splitWikilinks(value: string): (Text | WikilinkNode)[] {
  const parts: (Text | WikilinkNode)[] = [];
  let last = 0;
  for (const m of value.matchAll(WIKILINK)) {
    if (m.index > last)
      parts.push({ type: "text", value: value.slice(last, m.index) });
    const alias = m[2]?.trim();
    parts.push({
      type: "wikilink",
      target: m[1]!.trim(),
      ...(alias ? { alias } : {}),
    });
    last = m.index + m[0].length;
  }
  if (parts.length && last < value.length)
    parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

interface StringifyState {
  stack: string[];
}

/** `[[target|alias]]`, with the pipe escaped inside GFM table cells. */
export function wikilinkToMarkdown(
  node: WikilinkNode,
  inTable = false,
): string {
  if (!node.alias) return `[[${node.target}]]`;
  return `[[${node.target}${inTable ? "\\|" : "|"}${node.alias}]]`;
}

/**
 * Parses `[[wikilinks]]` (outside code and links) into `wikilink` nodes and
 * writes them back verbatim. remark-stringify would otherwise escape `[`
 * as `\[`, which the vault's link parser doesn't recognise.
 */
export const remarkWikilink: Plugin<[], Root> = function () {
  const data = this.data() as { toMarkdownExtensions?: unknown[] };
  (data.toMarkdownExtensions ??= []).push({
    handlers: {
      wikilink: (node: WikilinkNode, _parent: unknown, state: StringifyState) =>
        wikilinkToMarkdown(node, state.stack.includes("tableCell")),
    },
  });
  return (tree) => {
    visit(tree, "text", (node: Text, index, parent: Parents | undefined) => {
      if (
        !parent ||
        index === undefined ||
        parent.type === "link" ||
        parent.type === "linkReference"
      )
        return;
      const parts = splitWikilinks(node.value);
      if (!parts.length) return;
      parent.children.splice(index, 1, ...(parts as typeof parent.children));
      return [SKIP, index + parts.length];
    });
  };
};

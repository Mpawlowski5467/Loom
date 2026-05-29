import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Pluggable } from "unified";
import { Wikilink } from "../components/primitives/Wikilink";

/* ── remark plugin: [[wikilink]] / [[target|label]] → <loom-wikilink> ── */

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;

function splitWikilinkText(value: string): MdastNode[] | null {
  if (!value.includes("[[")) return null;
  WIKILINK_RE.lastIndex = 0;
  const out: MdastNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(value)) !== null) {
    if (match.index > last) {
      out.push({ type: "text", value: value.slice(last, match.index) });
    }
    const inner = match[1] ?? "";
    const pipe = inner.indexOf("|");
    const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
    const label = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
    out.push({
      type: "loomWikilink",
      data: { hName: "loom-wikilink", hProperties: { target, label } },
    });
    last = match.index + match[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transformWikilinks(node: MdastNode): void {
  const children = node.children;
  if (!children) return;
  const next: MdastNode[] = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      const split = splitWikilinkText(child.value);
      if (split) {
        next.push(...split);
        continue;
      }
    }
    transformWikilinks(child);
    next.push(child);
  }
  node.children = next;
}

function remarkWikilink() {
  return (tree: MdastNode): void => transformWikilinks(tree);
}

/* ── rehype plugin: deterministic heading ids in document order ── */

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING_TAG = /^h[1-6]$/;

function assignHeadingIds(node: HastNode, counter: { n: number }): void {
  if (
    node.type === "element" &&
    node.tagName &&
    HEADING_TAG.test(node.tagName)
  ) {
    node.properties = node.properties ?? {};
    if (node.properties.id == null) {
      node.properties.id = `loom-h-${counter.n++}`;
    }
  }
  if (node.children) {
    for (const child of node.children) assignHeadingIds(child, counter);
  }
}

function rehypeHeadingIds() {
  return (tree: HastNode): void => assignHeadingIds(tree, { n: 0 });
}

/* ── components ── */

const components = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  "loom-wikilink": ({ target, label }: { target?: string; label?: string }) => (
    <Wikilink target={target ?? ""} label={label ? label : undefined} />
  ),
} as unknown as Components;

const REMARK_PLUGINS: Pluggable[] = [
  remarkGfm,
  remarkWikilink as unknown as Pluggable,
];
const REHYPE_PLUGINS: Pluggable[] = [
  rehypeHeadingIds as unknown as Pluggable,
  rehypeHighlight,
];

export function Markdown({
  source,
  bodyClass,
}: {
  source: string;
  bodyClass?: string;
}): ReactElement {
  return (
    <div className={bodyClass}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

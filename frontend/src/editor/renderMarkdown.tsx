import type { ReactElement } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { toString as hastToString } from "mdast-util-to-string";
import { Markdown } from "./Markdown";

interface RenderOptions {
  bodyClass?: string;
}

export interface Heading {
  text: string;
  depth: number;
  id: string;
}

/** Back-compat helper for inline call sites (InboxView, ThreadView preview). */
export function renderMarkdown(
  md: string,
  opts: RenderOptions = {},
): ReactElement {
  return <Markdown source={md} bodyClass={opts.bodyClass} />;
}

/* ── shared HAST heading walk (the single source of truth for ids) ── */

export interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING_TAG = /^h[1-6]$/;

function isHeadingElement(node: HastNode): boolean {
  return (
    node.type === "element" &&
    typeof node.tagName === "string" &&
    HEADING_TAG.test(node.tagName)
  );
}

/**
 * Walk a rendered HAST tree in document order and invoke `onHeading` for each
 * h1–h6 element together with the sequential `loom-h-<n>` id it should receive.
 *
 * This is the single source of truth shared by two consumers: the live renderer
 * (``Markdown.tsx``'s ``rehypeHeadingIds`` plugin, which stamps the id onto the
 * node) and {@link extractHeadings} below (which collects the same ids for the
 * Thread outline). Because both derive ids from the identical walk over the same
 * remark→rehype pipeline, the Nth outline entry and the heading rendered with
 * ``loom-h-N`` always agree by construction.
 */
export function walkHeadings(
  node: HastNode,
  counter: { n: number },
  onHeading: (node: HastNode, id: string) => void,
): void {
  if (isHeadingElement(node)) {
    onHeading(node, `loom-h-${counter.n++}`);
  }
  if (node.children) {
    for (const child of node.children) walkHeadings(child, counter, onHeading);
  }
}

/* ── outline extraction ── */

/**
 * Strip wikilink syntax (showing the label when present) and inline marks so an
 * outline entry reads like the rendered heading rather than its raw source.
 */
function normalizeHeadingText(text: string): string {
  return text
    .replace(
      /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g,
      (_, target: string, label?: string) => (label ? label : target),
    )
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * Ordered list of headings with stable ids matching the ones the Markdown
 * renderer assigns (``loom-h-<n>`` in document order). Drives the Thread
 * outline and scroll-to-heading.
 *
 * It builds the heading set from the *same* remark→rehype pipeline the live
 * {@link Markdown} component renders with (``remark-parse`` + ``remark-gfm`` +
 * ``remark-rehype``) and walks the resulting HAST with the shared
 * {@link walkHeadings} traversal. So the heading set, order, and ids agree with
 * the rendered DOM by construction — covering ATX, setext, and
 * blockquote-nested headings while excluding ``#``/setext-looking lines inside
 * code fences.
 *
 * (The previous implementation enumerated only ATX headings via a line regex,
 * so a single setext or blockquote heading shifted every subsequent id and the
 * outline scrolled to the wrong section.)
 *
 * The wikilink remark transform is intentionally omitted: it only rewrites text
 * *within* a heading, never adds or removes heading nodes, so count/order/ids
 * are unaffected while {@link normalizeHeadingText} preserves the readable
 * label.
 */
export function extractHeadings(md: string): Heading[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true });
  const tree = processor.runSync(processor.parse(md)) as unknown as HastNode;

  const out: Heading[] = [];
  walkHeadings(tree, { n: 0 }, (node, id) => {
    out.push({
      text: normalizeHeadingText(hastToString(node as never)),
      depth: Number(node.tagName!.slice(1)),
      id,
    });
  });
  return out;
}

import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Pluggable } from "unified";
import { Wikilink } from "../components/primitives/Wikilink";
import { walkHeadings } from "./renderMarkdown";
import type { HastNode } from "./renderMarkdown";
import { useApp } from "../context/app-ctx";
import { apiUrl } from "../api/client";

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

/**
 * Stamp sequential ``loom-h-<n>`` ids onto every rendered h1–h6 in document
 * order. Uses the shared {@link walkHeadings} traversal so the ids on the live
 * DOM match the Thread outline built by ``extractHeadings`` exactly (see
 * ``renderMarkdown.tsx``).
 */
function rehypeHeadingIds(options?: { prefix?: string }) {
  return (tree: HastNode): void =>
    walkHeadings(tree, { n: 0 }, (node, id) => {
      node.properties = node.properties ?? {};
      if (node.properties.id == null) {
        node.properties.id = `${options?.prefix ?? ""}${id}`;
      }
    });
}

/* ── components ── */

function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function documentTarget(href: string, folder: string): string {
  const decoded = decodeFragment(href);
  if (!decoded.startsWith("./") && !decoded.startsWith("../"))
    return decoded.replace(/^\//, "");
  const parts = folder
    .replace(/^threads\//, "")
    .split("/")
    .filter(Boolean);
  for (const part of decoded.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function DocumentLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const { currentNoteId, openNote, noteById } = useApp();
  if (href?.startsWith("/api/imports/files/"))
    return (
      <a href={apiUrl(href)} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  if (href?.startsWith("#") && currentNoteId) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          openNote(currentNoteId, decodeFragment(href.slice(1)));
        }}
      >
        {children}
      </a>
    );
  }
  if (
    href &&
    !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) &&
    /\.md(?:#|$)/i.test(href)
  ) {
    return (
      <Wikilink
        target={documentTarget(
          href,
          currentNoteId ? (noteById(currentNoteId)?.folder ?? "") : "",
        )}
        label={typeof children === "string" ? children : undefined}
      />
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

const components = {
  a: DocumentLink,
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
  headingIdPrefix,
}: {
  source: string;
  bodyClass?: string;
  headingIdPrefix?: string;
}): ReactElement {
  return (
    <div className={bodyClass}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={
          headingIdPrefix
            ? [
                [
                  rehypeHeadingIds,
                  { prefix: headingIdPrefix },
                ] as unknown as Pluggable,
                rehypeHighlight,
              ]
            : REHYPE_PLUGINS
        }
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

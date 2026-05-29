import type { ReactElement } from "react";
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

function stripInline(text: string): string {
  return text
    .replace(
      /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g,
      (_, target: string, label?: string) => (label ? label : target),
    )
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * Ordered list of ATX headings with stable ids matching the ones the Markdown
 * renderer assigns (``loom-h-<n>`` in document order). Drives the Thread
 * outline and scroll-to-heading.
 */
export function extractHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  let index = 0;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) {
      out.push({
        text: stripInline(m[2]!),
        depth: m[1]!.length,
        id: `loom-h-${index++}`,
      });
    }
  }
  return out;
}

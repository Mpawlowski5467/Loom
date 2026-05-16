import type { ReactElement, ReactNode } from "react";
import { Wikilink } from "../components/primitives/Wikilink";

interface RenderOptions {
  bodyClass?: string;
}

const INLINE = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function parseInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(INLINE);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (!seg) continue;
    if (seg.startsWith("[[") && seg.endsWith("]]")) {
      const inner = seg.slice(2, -2);
      const [target, label] = inner.includes("|")
        ? inner.split("|")
        : [inner, undefined];
      out.push(<Wikilink key={i} target={target!} label={label} />);
    } else if (seg.startsWith("**") && seg.endsWith("**")) {
      out.push(<strong key={i}>{seg.slice(2, -2)}</strong>);
    } else if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) {
      out.push(<em key={i}>{seg.slice(1, -1)}</em>);
    } else if (seg.startsWith("`") && seg.endsWith("`")) {
      out.push(<code key={i}>{seg.slice(1, -1)}</code>);
    } else {
      out.push(seg);
    }
  }
  return out;
}

export function renderMarkdown(md: string, opts: RenderOptions = {}): ReactElement {
  const lines = md.split("\n");
  const blocks: ReactElement[] = [];
  let i = 0;
  let listBuffer: ReactNode[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {listBuffer.map((c, j) => (
          <li key={j}>{c}</li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    blocks.push(
      <pre key={`pre-${blocks.length}`}>
        <code>{codeBuffer.join("\n")}</code>
      </pre>,
    );
    codeBuffer = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      flushList();
      blocks.push(<h2 key={`h-${i}`}>{parseInline(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      blocks.push(<h3 key={`h-${i}`}>{parseInline(line.slice(4))}</h3>);
      i++;
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      listBuffer.push(parseInline(line.slice(2)));
      i++;
      continue;
    }
    if (line.trim() === "") {
      flushList();
      i++;
      continue;
    }
    // Paragraph — accumulate consecutive non-empty lines.
    flushList();
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() !== "" && !lines[j]!.startsWith("##") && !lines[j]!.startsWith("- ") && !lines[j]!.startsWith("```")) {
      paraLines.push(lines[j]!);
      j++;
    }
    blocks.push(<p key={`p-${i}`}>{parseInline(paraLines.join(" "))}</p>);
    i = j;
  }

  flushList();
  flushCode();

  return <div className={opts.bodyClass}>{blocks}</div>;
}

export function extractHeadings(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) out.push(line.slice(3).trim());
  }
  return out;
}

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppContextValue } from "../context/app-ctx";
import { AppCtx } from "../context/app-ctx";
import { extractHeadings, renderMarkdown } from "./renderMarkdown";

function renderMarkdownWithContext(markdown: string, openNote = vi.fn()) {
  const value = {
    resolveWikilink: (target: string) =>
      target === "Topic One" ? "thr_topic" : undefined,
    openNote,
    noteById: () => ({ type: "topic", folder: "threads/topics" }),
  } as unknown as AppContextValue;
  return render(
    <AppCtx.Provider value={value}>{renderMarkdown(markdown)}</AppCtx.Provider>,
  );
}

describe("renderMarkdown", () => {
  it("renders plain markdown", () => {
    renderMarkdownWithContext("## Heading\n\nHello Loom");

    expect(
      screen.getByRole("heading", { name: "Heading" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hello Loom")).toBeInTheDocument();
  });

  it("renders clickable wikilinks", async () => {
    const user = userEvent.setup();
    const openNote = vi.fn();
    renderMarkdownWithContext("See [[Topic One|topic]].", openNote);

    await user.click(screen.getByRole("button", { name: "Open note topic" }));

    expect(openNote).toHaveBeenCalledWith("thr_topic");
  });

  it("renders inline marks", () => {
    renderMarkdownWithContext("This has **bold**, *italic*, and `code`.");

    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });
});

describe("renderMarkdown — XSS safety", () => {
  // Lock-in: the renderer must stay XSS-safe (react-markdown v10, no
  // rehype-raw, default urlTransform). Note bodies are untrusted input.
  it("renders no <script>, no inline handlers, and no javascript: href", () => {
    const { container } = renderMarkdownWithContext(
      [
        "<script>alert(1)</script>",
        "",
        "<img src=x onerror=alert(1)>",
        "",
        "[click](javascript:alert(1))",
      ].join("\n"),
    );

    // Raw HTML never becomes DOM: no script element, no img with an onerror
    // handler. react-markdown (no rehype-raw) emits it as inert escaped text.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("&lt;script&gt;");
    expect(container.innerHTML).not.toContain("<script>");

    // No element anywhere in the tree carries an inline event handler.
    for (const el of Array.from(container.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
      }
    }

    // The link still renders its text, but the javascript: URL is neutralized
    // by the default urlTransform (it never becomes an href).
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe("click");
    expect(link!.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
  });

  it("keeps rendering safe markdown images without inline handlers", () => {
    const { container } = renderMarkdownWithContext(
      "![alt text](https://example.com/pic.png)",
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/pic.png");
    for (const attr of Array.from(img!.attributes)) {
      expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
    }
  });
});

describe("extractHeadings ↔ rendered heading ids", () => {
  // A document that exercises every heading form that used to drift between the
  // two enumerations: ATX, setext (= and -), a blockquote-nested heading, and a
  // fenced code block whose `#`/setext-looking lines must NOT count as headings.
  const mixedDoc = [
    "# Alpha ATX",
    "",
    "Bravo Setext",
    "============",
    "",
    "> ## Quoted Heading",
    "",
    "```",
    "## not a heading",
    "ALSO NOT A HEADING",
    "==================",
    "```",
    "",
    "Charlie Setext Sub",
    "------------------",
    "",
    "### Delta ATX",
    "",
    "## See [[Topic One|the topic]] here",
  ].join("\n");

  function renderedHeadingIds(container: HTMLElement): string[] {
    return Array.from(
      container.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    ).map((el) => el.id);
  }

  it("maps each outline entry 1:1 to the rendered heading with the same id", () => {
    const { container } = renderMarkdownWithContext(mixedDoc);
    const headings = extractHeadings(mixedDoc);
    const domIds = renderedHeadingIds(container);

    // Same count: the fenced `#`/`===` lines are excluded from both sides, and
    // setext + blockquote headings are included in both.
    expect(headings).toHaveLength(6);
    expect(domIds).toHaveLength(6);

    // Same ids, in the same document order.
    expect(headings.map((h) => h.id)).toEqual(domIds);
    expect(domIds).toEqual([
      "loom-h-0",
      "loom-h-1",
      "loom-h-2",
      "loom-h-3",
      "loom-h-4",
      "loom-h-5",
    ]);

    // Every outline id resolves to exactly the rendered heading at that index,
    // which is the invariant the Thread outline's getElementById(h.id) relies
    // on for scroll-to-heading.
    headings.forEach((h, i) => {
      const el = container.querySelector(`#${h.id}`);
      expect(el).not.toBeNull();
      expect(el).toBe(container.querySelectorAll("h1, h2, h3, h4, h5, h6")[i]);
    });
  });

  it("captures depth and readable text (setext, blockquote, wikilink label)", () => {
    const headings = extractHeadings(mixedDoc);

    expect(headings).toEqual([
      { id: "loom-h-0", depth: 1, text: "Alpha ATX" },
      { id: "loom-h-1", depth: 1, text: "Bravo Setext" },
      { id: "loom-h-2", depth: 2, text: "Quoted Heading" },
      { id: "loom-h-3", depth: 2, text: "Charlie Setext Sub" },
      { id: "loom-h-4", depth: 3, text: "Delta ATX" },
      // Wikilink label is shown, not the raw [[...]] source.
      { id: "loom-h-5", depth: 2, text: "See the topic here" },
    ]);
  });

  it("excludes heading-looking lines inside a fenced code block", () => {
    const headings = extractHeadings(mixedDoc);
    expect(headings.some((h) => h.text.includes("not a heading"))).toBe(false);
    expect(headings.some((h) => h.text.includes("NOT A HEADING"))).toBe(false);
  });

  it("returns an empty outline for prose with no headings", () => {
    const { container } = renderMarkdownWithContext("Just a paragraph.");
    expect(extractHeadings("Just a paragraph.")).toEqual([]);
    expect(
      container.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    ).toHaveLength(0);
  });
});

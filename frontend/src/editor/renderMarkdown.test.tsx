import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppContextValue } from "../context/app-ctx";
import { AppCtx } from "../context/app-ctx";
import { renderMarkdown } from "./renderMarkdown";

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

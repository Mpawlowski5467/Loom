import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { MiniGraph } from "./MiniGraph";
import type { Note } from "../../data/types";

function mkNote(over: Partial<Note> = {}): Note {
  return {
    id: "thr_focus",
    title: "Caching",
    type: "topic",
    folder: "topics",
    filename: "caching.md",
    tags: [],
    body: "",
    links: [],
    history: [],
    created: "2026-05-01T09:00:00Z",
    modified: "2026-05-01T09:00:00Z",
    status: "active",
    source: "manual",
    ...over,
  };
}

function renderMiniGraph() {
  const focus = mkNote({ id: "thr_focus", title: "Caching", links: ["thr_nb"] });
  const neighbor = mkNote({ id: "thr_nb", title: "Embeddings" });
  const byId: Record<string, Note> = { thr_focus: focus, thr_nb: neighbor };
  const openNote = vi.fn();
  const value = {
    noteById: (id: string) => byId[id] ?? null,
    backlinksFor: () => [],
    openNote,
  } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <MiniGraph focusId="thr_focus" />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { openNote };
}

describe("MiniGraph accessibility", () => {
  it("exposes neighbor nodes as accessible, labelled buttons", () => {
    renderMiniGraph();
    const node = screen.getByRole("button", { name: "Open Embeddings" });
    expect(node).toHaveAttribute("tabindex", "0");
  });

  it("the local-graph group is no longer hidden from assistive tech", () => {
    renderMiniGraph();
    const group = screen.getByRole("group", {
      name: /Local graph around Caching/,
    });
    expect(group).not.toHaveAttribute("aria-hidden");
  });

  it("opens the neighbor note on click", async () => {
    const user = userEvent.setup();
    const { openNote } = renderMiniGraph();

    await user.click(screen.getByRole("button", { name: "Open Embeddings" }));
    expect(openNote).toHaveBeenCalledWith("thr_nb");
  });

  it("opens the neighbor note on Enter and Space (keyboard path)", async () => {
    const user = userEvent.setup();
    const { openNote } = renderMiniGraph();

    const node = screen.getByRole("button", { name: "Open Embeddings" });
    node.focus();
    await user.keyboard("{Enter}");
    expect(openNote).toHaveBeenCalledWith("thr_nb");

    openNote.mockClear();
    await user.keyboard(" ");
    expect(openNote).toHaveBeenCalledWith("thr_nb");
  });
});

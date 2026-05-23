import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppContextValue } from "../../context/app-ctx";
import { AppCtx } from "../../context/app-ctx";
import { Wikilink } from "./Wikilink";

function renderWithContext(ui: ReactNode, openNote = vi.fn()) {
  const value = {
    resolveWikilink: (target: string) =>
      target === "Topic One" ? "thr_topic" : undefined,
    openNote,
    noteById: () => ({ type: "topic", folder: "threads/topics" }),
  } as unknown as AppContextValue;
  return render(<AppCtx.Provider value={value}>{ui}</AppCtx.Provider>);
}

describe("Wikilink", () => {
  it("renders the wikilink text", () => {
    renderWithContext(<Wikilink target="Topic One" label="topic" />);

    expect(
      screen.getByRole("button", { name: "Open note topic" }),
    ).toHaveTextContent("topic");
  });

  it("clicking calls the handler with the target name", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const openNote = vi.fn();
    renderWithContext(
      <Wikilink target="Topic One" onOpen={onOpen} />,
      openNote,
    );

    await user.click(
      screen.getByRole("button", { name: "Open note Topic One" }),
    );

    expect(onOpen).toHaveBeenCalledWith("Topic One");
    expect(openNote).toHaveBeenCalledWith("thr_topic");
  });
});

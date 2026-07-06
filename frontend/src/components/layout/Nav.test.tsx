import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApp } = vi.hoisted(() => ({ useApp: vi.fn() }));
vi.mock("../../context/app-ctx", () => ({ useApp }));
// The animated logo mark is presentation-only noise for these tests.
vi.mock("../primitives/LoomMark", () => ({ LoomMark: () => null }));

import { Nav } from "./Nav";

function appState(over: Record<string, unknown> = {}) {
  return {
    tab: "graph",
    setTab: vi.fn(),
    setPaletteOpen: vi.fn(),
    setNewNoteOpen: vi.fn(),
    treeVisible: true,
    setTreeVisible: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  useApp.mockReset().mockReturnValue(appState());
});

describe("Nav", () => {
  it("renders the four view tabs and marks the active one selected", () => {
    useApp.mockReturnValue(appState({ tab: "inbox" }));
    render(<Nav />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Graph",
      "Thread",
      "Inbox",
      "Board",
    ]);
    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("clicking a tab calls setTab with its value", async () => {
    const user = userEvent.setup();
    const setTab = vi.fn();
    useApp.mockReturnValue(appState({ setTab }));
    render(<Nav />);

    await user.click(screen.getByRole("tab", { name: "Board" }));

    expect(setTab).toHaveBeenCalledWith("board");
  });

  it.each(["graph", "board"] as const)(
    "shows the tree toggle on the %s tab",
    (tab) => {
      useApp.mockReturnValue(appState({ tab }));
      render(<Nav />);
      expect(
        screen.getByRole("button", { name: "Toggle file tree" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["thread", "inbox", "settings"] as const)(
    "hides the tree toggle on the %s tab",
    (tab) => {
      useApp.mockReturnValue(appState({ tab }));
      render(<Nav />);
      expect(
        screen.queryByRole("button", { name: "Toggle file tree" }),
      ).not.toBeInTheDocument();
    },
  );

  it("clicking the toggle flips treeVisible", async () => {
    const user = userEvent.setup();
    const setTreeVisible = vi.fn();
    useApp.mockReturnValue(appState({ treeVisible: true, setTreeVisible }));
    render(<Nav />);

    await user.click(screen.getByRole("button", { name: "Toggle file tree" }));

    expect(setTreeVisible).toHaveBeenCalledWith(false);
  });

  it("aria-pressed mirrors the treeVisible state", () => {
    useApp.mockReturnValue(appState({ treeVisible: false }));
    render(<Nav />);

    expect(
      screen.getByRole("button", { name: "Toggle file tree" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

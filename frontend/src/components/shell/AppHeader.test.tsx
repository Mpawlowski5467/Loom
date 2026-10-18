import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import { TestAppearanceProvider } from "@/test/appearance";
import { AppHeader } from "./AppHeader";

function renderHeader(
  ctx: Partial<AppContextValue> = {},
  toggleMode = vi.fn(),
  path = "/graph",
) {
  const value = {
    captures: [
      { id: "c1", status: "pending" },
      { id: "c2", status: "needs_review" },
      { id: "c3", status: "done" },
    ],
    agentActivity: {},
    offline: false,
    setTab: vi.fn(),
    setPaletteOpen: vi.fn(),
    setNewNoteOpen: vi.fn(),
    ...ctx,
  } as unknown as AppContextValue;
  render(
    <MemoryRouter initialEntries={[path]}>
      <TestAppearanceProvider overrides={{ toggleMode }}>
        <TooltipProvider>
          <AppCtx.Provider value={value}>
            <AppHeader />
          </AppCtx.Provider>
        </TooltipProvider>
      </TestAppearanceProvider>
    </MemoryRouter>,
  );
  return value;
}

describe("AppHeader", () => {
  it("shows the five views with the active one marked", () => {
    renderHeader({}, vi.fn(), "/board");
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(nav).toHaveTextContent(/Graph.*Notes.*Board.*Inbox.*Threads/);
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("counts captures still in the inbox", () => {
    renderHeader();
    expect(
      screen.getByRole("link", { name: "Inbox (2 waiting)" }),
    ).toBeInTheDocument();
  });

  it("reports agent status", () => {
    renderHeader({
      agentActivity: {
        weaver: { name: "weaver", state: "running" },
      } as unknown as AppContextValue["agentActivity"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("Weaver running…");
  });

  it("says agents are idle when nothing runs", () => {
    renderHeader();
    expect(screen.getByRole("status")).toHaveTextContent("Agents idle");
  });

  it("opens the palette from the search trigger", async () => {
    const user = userEvent.setup();
    const ctx = renderHeader();
    await user.click(screen.getByRole("button", { name: /search notes/i }));
    expect(ctx.setPaletteOpen).toHaveBeenCalledWith(true);
  });

  it("opens the new-note dialog", async () => {
    const user = userEvent.setup();
    const ctx = renderHeader();
    await user.click(screen.getByRole("button", { name: "New note" }));
    expect(ctx.setNewNoteOpen).toHaveBeenCalledWith(true);
  });

  it("flips to the light theme from the quick toggle", async () => {
    const user = userEvent.setup();
    const toggleMode = vi.fn();
    renderHeader({}, toggleMode);
    await user.click(
      await screen.findByRole("button", { name: "Switch to Paper" }),
    );
    expect(toggleMode).toHaveBeenCalled();
  });
});

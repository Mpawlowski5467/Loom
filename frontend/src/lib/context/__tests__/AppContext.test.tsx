import React from "react";
import { render, screen, act } from "@testing-library/react";
import { AppProvider } from "../AppContext";
import { useApp } from "../useApp";

/** Helper component that exposes context values for assertions. */
function Inspector() {
  const ctx = useApp();

  return (
    <div>
      <span data-testid="view">{ctx.activeView}</span>
      <span data-testid="note">{ctx.activeNote ?? "null"}</span>
      <span data-testid="sidebar">{ctx.sidebarMode}</span>
      <span data-testid="modal">{String(ctx.isCreateModalOpen)}</span>
      <button data-testid="select-note" onClick={() => ctx.selectNote("thr_abc123")}>
        select
      </button>
      <button data-testid="clear-note" onClick={() => ctx.selectNote(null)}>
        clear
      </button>
      <button data-testid="set-board" onClick={() => ctx.setActiveView("board")}>
        board
      </button>
      <button data-testid="set-inbox" onClick={() => ctx.setActiveView("inbox")}>
        inbox
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AppProvider>
      <Inspector />
    </AppProvider>,
  );
}

describe("AppContext", () => {
  it("provides correct initial state", () => {
    renderWithProvider();

    expect(screen.getByTestId("view")).toHaveTextContent("graph");
    expect(screen.getByTestId("note")).toHaveTextContent("null");
    expect(screen.getByTestId("sidebar")).toHaveTextContent("view");
    expect(screen.getByTestId("modal")).toHaveTextContent("false");
  });

  it("selectNote updates activeNote", () => {
    renderWithProvider();

    act(() => {
      screen.getByTestId("select-note").click();
    });

    expect(screen.getByTestId("note")).toHaveTextContent("thr_abc123");
  });

  it("selectNote(null) clears activeNote", () => {
    renderWithProvider();

    act(() => {
      screen.getByTestId("select-note").click();
    });
    expect(screen.getByTestId("note")).toHaveTextContent("thr_abc123");

    act(() => {
      screen.getByTestId("clear-note").click();
    });
    expect(screen.getByTestId("note")).toHaveTextContent("null");
  });

  it("setActiveView updates the view", () => {
    renderWithProvider();

    act(() => {
      screen.getByTestId("set-board").click();
    });
    expect(screen.getByTestId("view")).toHaveTextContent("board");

    act(() => {
      screen.getByTestId("set-inbox").click();
    });
    expect(screen.getByTestId("view")).toHaveTextContent("inbox");
  });

  it("throws when useApp is used outside AppProvider", () => {
    // Suppress React error boundary console output during this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Inspector />)).toThrow("useApp must be used within AppProvider");

    consoleSpy.mockRestore();
  });
});

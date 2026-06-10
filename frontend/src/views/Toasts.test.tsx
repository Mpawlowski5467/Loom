import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { Toasts } from "./Toasts";
import type { Toast } from "../data/types";

function renderToasts(toasts: Toast[]) {
  const dismissToast = vi.fn();
  const value = { toasts, dismissToast } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <Toasts />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { dismissToast };
}

const TOAST: Toast = { id: "t1", icon: "✓", body: "Saved your note" };

describe("Toasts", () => {
  it("renders each toast as a focusable button", () => {
    renderToasts([TOAST]);
    const btn = screen.getByRole("button", { name: /Dismiss notification/ });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Saved your note");
  });

  it("dismisses on click", async () => {
    const user = userEvent.setup();
    const { dismissToast } = renderToasts([TOAST]);

    await user.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(dismissToast).toHaveBeenCalledWith("t1");
  });

  it("dismisses via keyboard (Enter and Space) for keyboard users", async () => {
    const user = userEvent.setup();
    const { dismissToast } = renderToasts([TOAST]);

    const btn = screen.getByRole("button", { name: /Dismiss/ });
    btn.focus();
    expect(btn).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(dismissToast).toHaveBeenCalledWith("t1");

    dismissToast.mockClear();
    await user.keyboard(" ");
    expect(dismissToast).toHaveBeenCalledWith("t1");
  });
});

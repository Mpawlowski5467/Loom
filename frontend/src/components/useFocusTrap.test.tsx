import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useFocusTrap } from "./useFocusTrap";

function Dialog({
  onEscape,
  skipInitialFocus,
}: {
  onEscape?: () => void;
  skipInitialFocus?: boolean;
}): React.ReactNode {
  const ref = useFocusTrap<HTMLDivElement>({ onEscape, skipInitialFocus });
  return (
    <div ref={ref} role="dialog">
      <button>first</button>
      <button>second</button>
      <button>last</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("focuses the first focusable element on mount", () => {
    render(<Dialog />);
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("does not steal focus when skipInitialFocus is set", () => {
    render(
      <>
        <button>outside</button>
        <Dialog skipInitialFocus />
      </>,
    );
    // No element inside the dialog grabbed focus.
    expect(screen.getByRole("button", { name: "first" })).not.toHaveFocus();
  });

  it("calls onEscape when Escape is pressed", async () => {
    const onEscape = vi.fn();
    const user = userEvent.setup();
    render(<Dialog onEscape={onEscape} />);
    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last element back to the first", async () => {
    const user = userEvent.setup();
    render(<Dialog />);
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("wraps Shift+Tab from the first element to the last", async () => {
    const user = userEvent.setup();
    render(<Dialog />);
    // First element is focused on mount.
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "last" })).toHaveFocus();
  });

  it("restores focus to the previously-focused element on unmount", async () => {
    const user = userEvent.setup();

    function Harness(): React.ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && <Dialog onEscape={() => setOpen(false)} />}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "open" });
    trigger.focus();
    await user.click(trigger);
    // Dialog open -> focus moved inside.
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
    // Close via Escape -> focus returns to the trigger.
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("uses the latest onEscape closure, not a stale one", async () => {
    const user = userEvent.setup();

    function Harness(): React.ReactNode {
      const [count, setCount] = useState(0);
      // onEscape recreated each render; the hook must call the current one.
      const ref = useFocusTrap<HTMLDivElement>({
        onEscape: () => setCount((c) => c + 1),
      });
      return (
        <div ref={ref} role="dialog">
          <span data-testid="count">{count}</span>
          <button>x</button>
        </div>
      );
    }

    render(<Harness />);
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("count").textContent).toBe("2");
  });
});

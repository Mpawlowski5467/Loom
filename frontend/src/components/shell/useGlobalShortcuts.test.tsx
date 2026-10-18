import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useGlobalShortcuts,
  type ShortcutHandlers,
} from "./useGlobalShortcuts";

function handlers(): ShortcutHandlers {
  return {
    togglePalette: vi.fn(),
    closePalette: vi.fn(() => true),
    newNote: vi.fn(),
    quickCapture: vi.fn(),
    toggleTree: vi.fn(),
    openSettings: vi.fn(),
    goTo: vi.fn(),
  };
}

function Harness({ h }: { h: ShortcutHandlers }) {
  useGlobalShortcuts(h);
  return (
    <div>
      <input aria-label="field" />
      <div role="dialog">
        <button>inside dialog</button>
      </div>
    </div>
  );
}

const key = (
  target: Element | Window,
  k: string,
  init: KeyboardEventInit = {},
) => fireEvent.keyDown(target, { key: k, ...init });

describe("useGlobalShortcuts", () => {
  let h: ShortcutHandlers;
  beforeEach(() => {
    h = handlers();
  });

  it.each([
    ["g", "graph"],
    ["n", "notes"],
    ["b", "board"],
    ["i", "inbox"],
    ["t", "threads"],
  ])("g %s opens %s", (second, view) => {
    render(<Harness h={h} />);
    key(document.body, "g");
    key(document.body, second);
    expect(h.goTo).toHaveBeenCalledWith(view);
  });

  it("stops a chord's second key reaching view handlers", () => {
    const viewHandler = vi.fn();
    document.addEventListener("keydown", viewHandler);
    render(<Harness h={h} />);
    key(document.body, "g");
    key(document.body, "i");
    expect(viewHandler).toHaveBeenCalledTimes(1); // only the "g"
    document.removeEventListener("keydown", viewHandler);
  });

  it("ignores chords while typing or inside a dialog", () => {
    const { getByLabelText, getByRole } = render(<Harness h={h} />);
    key(getByLabelText("field"), "g");
    key(getByLabelText("field"), "i");
    key(getByRole("button", { name: "inside dialog" }), "g");
    key(getByRole("button", { name: "inside dialog" }), "b");
    expect(h.goTo).not.toHaveBeenCalled();
  });

  it("needs the second key within the chord window", () => {
    vi.useFakeTimers();
    render(<Harness h={h} />);
    key(document.body, "g");
    vi.advanceTimersByTime(1500);
    key(document.body, "i");
    expect(h.goTo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("handles the modifier shortcuts, even from an input", () => {
    const { getByLabelText } = render(<Harness h={h} />);
    key(getByLabelText("field"), "k", { metaKey: true });
    key(document.body, "k", { ctrlKey: true });
    key(document.body, "n", { metaKey: true });
    key(document.body, "C", { metaKey: true, shiftKey: true });
    key(document.body, "b", { metaKey: true });
    key(document.body, ";", { metaKey: true });
    expect(h.togglePalette).toHaveBeenCalledTimes(2);
    expect(h.newNote).toHaveBeenCalled();
    expect(h.quickCapture).toHaveBeenCalled();
    expect(h.toggleTree).toHaveBeenCalled();
    expect(h.openSettings).toHaveBeenCalled();
  });

  it("Esc closes the palette", () => {
    render(<Harness h={h} />);
    key(document.body, "Escape");
    expect(h.closePalette).toHaveBeenCalled();
  });
});

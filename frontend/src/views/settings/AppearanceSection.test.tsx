import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { AppearanceSection } from "./AppearanceSection";

/** Stub prefers-color-scheme for the follow-OS effect. */
function stubMatchMedia(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: dark,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderSection(theme = "paper") {
  const setTheme = vi.fn().mockResolvedValue(undefined);
  const value = { theme, setTheme } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <AppearanceSection />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { setTheme };
}

beforeEach(() => {
  window.localStorage.clear();
  stubMatchMedia(false); // OS prefers light by default
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppearanceSection", () => {
  it("shows the current theme in the status line", () => {
    renderSection("slate");
    expect(screen.getByRole("status")).toHaveTextContent("Current theme: slate");
  });

  it("updates the font-scale selection and reflects it via aria-pressed", async () => {
    const user = userEvent.setup();
    renderSection();
    const large = screen.getByRole("button", { name: "Large" });
    expect(large).toHaveAttribute("aria-pressed", "false");
    await user.click(large);
    expect(large).toHaveAttribute("aria-pressed", "true");
    // The previously-pressed default (Normal) is now off.
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("updates the density selection", async () => {
    const user = userEvent.setup();
    renderSection();
    const compact = screen.getByRole("button", { name: "Compact" });
    await user.click(compact);
    expect(compact).toHaveAttribute("aria-pressed", "true");
  });

  it("updates the motion selection", async () => {
    const user = userEvent.setup();
    renderSection();
    const reduce = screen.getByRole("button", { name: "Reduce motion" });
    await user.click(reduce);
    expect(reduce).toHaveAttribute("aria-pressed", "true");
  });

  it("renders all three typography/spacing groups", () => {
    renderSection();
    expect(screen.getByText("Font size")).toBeInTheDocument();
    expect(screen.getByText("UI density")).toBeInTheDocument();
    expect(screen.getByText("Motion")).toBeInTheDocument();
  });

  it("groups themes into Light and Dark sections", () => {
    renderSection();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
  });
});

describe("AppearanceSection — reset to defaults", () => {
  it("disables the reset button while appearance is at defaults", () => {
    renderSection();
    expect(
      screen.getByRole("button", { name: /Reset to defaults/ }),
    ).toBeDisabled();
  });

  it("restores defaults after a change", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Large" }));
    const reset = screen.getByRole("button", { name: /Reset to defaults/ });
    expect(reset).toBeEnabled();

    await user.click(reset);
    // Back to the default "Normal" font size.
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(reset).toBeDisabled();
  });
});

describe("AppearanceSection — follow OS appearance", () => {
  it("starts unchecked and lets the user pick a theme", () => {
    renderSection();
    expect(screen.getByLabelText("Follow OS appearance")).not.toBeChecked();
  });

  it("adopts the OS-appropriate theme when enabled", async () => {
    const user = userEvent.setup();
    stubMatchMedia(true); // OS prefers dark
    const { setTheme } = renderSection("paper"); // current is a light theme

    await user.click(screen.getByLabelText("Follow OS appearance"));
    // Switches away from the light theme toward a dark one.
    expect(setTheme).toHaveBeenCalled();
    expect(setTheme.mock.calls[0]![0]).not.toBe("paper");
  });

  it("reflects the following state in the status line", async () => {
    const user = userEvent.setup();
    renderSection("paper"); // OS light + light theme → no switch needed
    await user.click(screen.getByLabelText("Follow OS appearance"));
    expect(screen.getByRole("status")).toHaveTextContent("Following OS");
  });

  it("turns off when the user manually picks a theme", async () => {
    const user = userEvent.setup();
    renderSection("paper");
    const toggle = screen.getByLabelText("Follow OS appearance");
    await user.click(toggle);
    expect(toggle).toBeChecked();

    // Pick a theme card → follow-OS clears.
    await user.click(screen.getAllByRole("radio")[0]!);
    expect(screen.getByLabelText("Follow OS appearance")).not.toBeChecked();
  });
});

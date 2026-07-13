import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { AppearanceSection } from "./AppearanceSection";

function renderSection(
  theme = "paper",
  opts: { followOsTheme?: boolean } = {},
) {
  const setTheme = vi.fn().mockResolvedValue(undefined);
  const setFollowOsTheme = vi.fn();
  const value = {
    theme,
    setTheme,
    followOsTheme: opts.followOsTheme ?? false,
    setFollowOsTheme,
  } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <AppearanceSection />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { setTheme, setFollowOsTheme };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("AppearanceSection", () => {
  it("shows the current theme in the status line", () => {
    renderSection("porcelain");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Current theme: porcelain",
    );
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

  it("updates the font style and applies its root class", async () => {
    const user = userEvent.setup();
    renderSection();
    const literary = screen.getByRole("button", { name: /Literary/ });
    await user.click(literary);
    expect(literary).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveClass("font-preset-literary");
  });

  it("offers six independent font presets", () => {
    renderSection();
    const group = screen.getByRole("group", { name: "Font style" });
    expect(group.querySelectorAll("button")).toHaveLength(6);
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

  it("renders all typography/spacing groups", () => {
    renderSection();
    expect(screen.getByText("Font style")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /Modern/ }));
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
    expect(
      screen.getByRole("button", { name: /Loom Editorial/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(reset).toBeDisabled();
  });
});

describe("AppearanceSection — follow OS appearance", () => {
  it("starts unchecked when not following the OS", () => {
    renderSection();
    expect(screen.getByLabelText("Follow OS appearance")).not.toBeChecked();
  });

  it("reflects the following state from context", () => {
    renderSection("midnight", { followOsTheme: true });
    expect(screen.getByLabelText("Follow OS appearance")).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Following OS");
  });

  it("enabling the toggle asks the app to follow the OS", async () => {
    const user = userEvent.setup();
    const { setFollowOsTheme } = renderSection("paper");
    await user.click(screen.getByLabelText("Follow OS appearance"));
    expect(setFollowOsTheme).toHaveBeenCalledWith(true);
  });

  it("disabling the toggle asks the app to stop following the OS", async () => {
    const user = userEvent.setup();
    const { setFollowOsTheme } = renderSection("midnight", {
      followOsTheme: true,
    });
    await user.click(screen.getByLabelText("Follow OS appearance"));
    expect(setFollowOsTheme).toHaveBeenCalledWith(false);
  });

  it("locks the theme grid while following the OS", () => {
    const { container } = renderWithContainer("midnight", {
      followOsTheme: true,
    });
    expect(container.querySelector(".settings-theme-locked")).not.toBeNull();
  });

  it("picking a theme manually routes through setTheme (which clears follow-OS)", async () => {
    const user = userEvent.setup();
    const { setTheme } = renderSection("paper");
    await user.click(screen.getAllByRole("radio")[0]!);
    expect(setTheme).toHaveBeenCalled();
  });
});

/** Variant that also returns the container for class-based assertions. */
function renderWithContainer(
  theme: string,
  opts: { followOsTheme?: boolean } = {},
) {
  const value = {
    theme,
    setTheme: vi.fn().mockResolvedValue(undefined),
    followOsTheme: opts.followOsTheme ?? false,
    setFollowOsTheme: vi.fn(),
  } as unknown as AppContextValue;
  return render(
    <AppCtx.Provider value={value}>
      <AppearanceSection />
    </AppCtx.Provider>,
  );
}

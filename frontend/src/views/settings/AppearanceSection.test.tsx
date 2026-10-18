import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appearanceEndpointUnsupported,
  getAppearance,
  putAppearance,
} from "@/api/appearance";
import { stubPrefersDark } from "@/test/matchMedia";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { AppearanceSection } from "./AppearanceSection";

vi.mock("@/api/appearance", () => ({
  getAppearance: vi.fn(),
  putAppearance: vi.fn(),
  appearanceEndpointUnsupported: vi.fn(),
}));

const html = () => document.documentElement;

function renderPage() {
  return render(
    <ThemeProvider>
      <AppearanceSection />
    </ThemeProvider>,
  );
}

describe("AppearanceSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getAppearance).mockResolvedValue(null);
    vi.mocked(putAppearance).mockResolvedValue(true);
    vi.mocked(appearanceEndpointUnsupported).mockReturnValue(false);
    stubPrefersDark(true);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("offers the six themes with Graphite selected by default", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const cards = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Graphite",
      "Paper",
      "Midnight",
      "Forest",
      "Linen",
      "High contrast",
    ]);
    expect(screen.getByRole("radio", { name: "Graphite" })).toBeChecked();
  });

  it("applies a theme to the whole app when its card is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("radio", { name: "Linen" }));
    expect(html()).toHaveAttribute("data-theme", "linen");
    expect(screen.getByRole("radio", { name: "Linen" })).toBeChecked();
  });

  it("follows the system with a theme per mode", async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = screen.getByRole("switch", {
      name: "Follow system appearance",
    });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    // The OS is dark, so the dark-mode choice (Graphite) is on screen.
    expect(html()).toHaveAttribute("data-theme", "graphite");
    expect(
      screen.getByRole("combobox", { name: "When the system is light" }),
    ).toHaveTextContent("Paper");
  });

  it("sets and names the accent override", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("radio", { name: "Teal" }));
    expect(html()).toHaveAttribute("data-brand", "teal");
    expect(screen.getByText("Teal", { selector: "span" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Theme default" }));
    expect(html()).not.toHaveAttribute("data-brand");
  });

  it("switches the editor font, graph palette and text size", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("radio", { name: "Newsreader" }));
    expect(html()).toHaveAttribute("data-editor-font", "serif");

    await user.click(screen.getByRole("radio", { name: "Colorblind-safe" }));
    expect(html()).toHaveAttribute("data-graph-palette", "colorblind");

    await user.click(screen.getByRole("radio", { name: "Large" }));
    expect(html()).toHaveAttribute("data-text-size", "lg");
  });

  it("resets everything to the defaults", async () => {
    const user = userEvent.setup();
    renderPage();
    const reset = screen.getByRole("button", { name: /reset to defaults/i });
    expect(reset).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Forest" }));
    await user.click(screen.getByRole("radio", { name: "Rose" }));
    await user.click(reset);
    expect(html()).toHaveAttribute("data-theme", "graphite");
    expect(html()).not.toHaveAttribute("data-brand");
  });

  it("says where settings are saved", async () => {
    vi.mocked(appearanceEndpointUnsupported).mockReturnValue(true);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/saved on this device/i)).toBeInTheDocument(),
    );
  });
});

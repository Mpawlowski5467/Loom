import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { SettingsView } from "./SettingsView";
import type { SettingsSection } from "../data/types";

// Each section is its own API-driven unit; stub them so SettingsView's job —
// the nav rail and which section renders — is what's under test.
vi.mock("./settings/AppearanceSection", () => ({
  AppearanceSection: () => <div data-testid="sec-appearance" />,
}));
vi.mock("./settings/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="sec-providers" />,
}));
vi.mock("./settings/HardwareSection", () => ({
  HardwareSection: () => <div data-testid="sec-hardware" />,
}));
vi.mock("./settings/VaultSection", () => ({
  VaultSection: () => <div data-testid="sec-vault" />,
}));
vi.mock("./settings/ArchivedSection", () => ({
  ArchivedSection: () => <div data-testid="sec-archived" />,
}));
vi.mock("./settings/AboutSection", () => ({
  AboutSection: () => <div data-testid="sec-about" />,
}));
vi.mock("./settings/DangerZoneSection", () => ({
  DangerZoneSection: () => <div data-testid="sec-danger" />,
}));

function renderSettings(section: SettingsSection = "appearance") {
  const setSettingsSection = vi.fn();
  const value = {
    settingsSection: section,
    setSettingsSection,
  } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <SettingsView />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { setSettingsSection };
}

describe("SettingsView", () => {
  it("renders a nav item for every section", () => {
    renderSettings();
    for (const label of [
      "Appearance",
      "Providers",
      "Hardware & Models",
      "Vault",
      "Archived",
      "About",
      "Danger",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("renders the active section's content", () => {
    renderSettings("providers");
    expect(screen.getByTestId("sec-providers")).toBeInTheDocument();
    expect(screen.queryByTestId("sec-appearance")).not.toBeInTheDocument();
  });

  it("marks the active section as the current page", () => {
    renderSettings("vault");
    expect(screen.getByRole("button", { name: "Vault" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "About" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("switches sections when a nav item is clicked", async () => {
    const user = userEvent.setup();
    const { setSettingsSection } = renderSettings("appearance");
    await user.click(screen.getByRole("button", { name: "Danger" }));
    expect(setSettingsSection).toHaveBeenCalledWith("danger");
  });

  it.each([
    ["appearance", "sec-appearance"],
    ["providers", "sec-providers"],
    ["hardware", "sec-hardware"],
    ["vault", "sec-vault"],
    ["archived", "sec-archived"],
    ["about", "sec-about"],
    ["danger", "sec-danger"],
  ] as const)("routes %s to the right section", (section, testid) => {
    renderSettings(section);
    expect(screen.getByTestId(testid)).toBeInTheDocument();
  });
});

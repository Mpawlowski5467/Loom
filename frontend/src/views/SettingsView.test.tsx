import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, it, expect, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { SettingsView } from "./SettingsView";
import { settingsSectionFrom } from "../app/routes";

// Each section is its own API-driven unit; stub them so SettingsView's job —
// the nav and which panels render for each section — is what's under test.
const { stub } = vi.hoisted(() => ({
  stub: (id: string) =>
    function Stub() {
      return <div data-testid={id} />;
    },
}));
vi.mock("./settings/AppearanceSection", () => ({
  AppearanceSection: stub("appearance"),
}));
vi.mock("./settings/ProvidersSection", () => ({
  ProvidersSection: stub("providers"),
}));
vi.mock("./settings/HardwareScanCard", () => ({
  HardwareScanCard: stub("hardware-scan"),
}));
vi.mock("./settings/ModelAdvisorCard", () => ({
  ModelAdvisorCard: stub("model-advisor"),
}));
vi.mock("./settings/AgentModelsCard", () => ({
  AgentModelsCard: stub("agent-models"),
}));
vi.mock("./settings/PolicySection", () => ({ PolicySection: stub("policy") }));
vi.mock("./settings/ConnectionsSection", () => ({
  ConnectionsSection: stub("connections"),
}));
vi.mock("./settings/VaultSection", () => ({ VaultSection: stub("vault") }));
vi.mock("./settings/ArchivedSection", () => ({
  ArchivedSection: stub("archived"),
}));
vi.mock("./settings/AboutSection", () => ({ AboutSection: stub("about") }));
vi.mock("./settings/DangerZoneSection", () => ({
  DangerZoneSection: stub("danger"),
}));

/** Provides settingsSection from the URL, as AppContext does. */
function RoutedSettings(): ReactNode {
  const { pathname } = useLocation();
  const section = settingsSectionFrom(pathname.split("/")[2]);
  const value = { settingsSection: section } as unknown as AppContextValue;
  return (
    <AppCtx.Provider value={value}>
      <SettingsView />
      <output aria-label="path">{pathname}</output>
    </AppCtx.Provider>
  );
}

function renderSettings(path = "/settings/appearance") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:section?" element={<RoutedSettings />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsView", () => {
  it("lists the seven sections in order", () => {
    renderSettings();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(
      Array.from(nav.querySelectorAll("a")).map((a) => a.textContent),
    ).toEqual([
      "General",
      "Appearance",
      "Agents",
      "Models & providers",
      "Privacy",
      "Integrations",
      "Vault",
    ]);
  });

  it("marks the active section as the current page", () => {
    renderSettings("/settings/vault");
    expect(screen.getByRole("link", { name: "Vault" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "General" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("navigates to a section's URL when its link is clicked", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("link", { name: "Privacy" }));
    expect(screen.getByLabelText("path")).toHaveTextContent(
      "/settings/privacy",
    );
    expect(screen.getByTestId("policy")).toBeInTheDocument();
  });

  it.each([
    ["general", ["about"]],
    ["appearance", ["appearance"]],
    ["agents", ["agent-models"]],
    ["models", ["providers", "hardware-scan", "model-advisor"]],
    ["privacy", ["policy"]],
    ["integrations", ["connections"]],
    ["vault", ["vault", "archived", "danger"]],
  ])("renders the existing panels for %s", (section, ids) => {
    renderSettings(`/settings/${section}`);
    for (const id of ids) expect(screen.getByTestId(id)).toBeInTheDocument();
  });
});

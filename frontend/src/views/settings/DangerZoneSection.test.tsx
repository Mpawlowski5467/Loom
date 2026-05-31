import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { DangerZoneSection } from "./DangerZoneSection";

const { resetOnboarding, archiveVault, hardDeleteVault, vaultExportUrl } =
  vi.hoisted(() => ({
    resetOnboarding: vi.fn(),
    archiveVault: vi.fn(),
    hardDeleteVault: vi.fn(),
    vaultExportUrl: vi.fn(() => "http://x/export"),
  }));

vi.mock("../../api/onboarding", () => ({ resetOnboarding }));
vi.mock("../../api/vault", () => ({
  archiveVault,
  hardDeleteVault,
  vaultExportUrl,
}));

function renderSection(activeVault: string | null) {
  const refreshConfig = vi.fn().mockResolvedValue(undefined);
  const value = {
    config: activeVault ? { active_vault: activeVault } : {},
    refreshConfig,
  } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <DangerZoneSection />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { refreshConfig };
}

beforeEach(() => {
  resetOnboarding.mockReset().mockResolvedValue(undefined);
  archiveVault.mockReset().mockResolvedValue({ archived_name: "main" });
  hardDeleteVault.mockReset().mockResolvedValue(undefined);
});

describe("DangerZoneSection", () => {
  it("opens a typed-confirm modal for reset onboarding and runs it on confirm", async () => {
    const user = userEvent.setup();
    const { refreshConfig } = renderSection("main");

    await user.click(screen.getByRole("button", { name: "Reset onboarding" }));
    // Modal demands the exact phrase. Scope to the dialog — the card action
    // button shares the "Reset onboarding" label.
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "RESET ONBOARDING");
    await user.click(
      within(dialog).getByRole("button", { name: "Reset onboarding" }),
    );

    await waitFor(() => expect(resetOnboarding).toHaveBeenCalled());
    expect(refreshConfig).toHaveBeenCalled();
  });

  it("hard-deletes the active vault behind a name-typed confirm", async () => {
    const user = userEvent.setup();
    renderSection("main");

    await user.click(
      screen.getByRole("button", { name: "Permanently delete vault" }),
    );
    const input = await screen.findByRole("textbox");
    await user.type(input, "main"); // delete phrase is the vault name
    await user.click(screen.getByRole("button", { name: "Permanently delete" }));

    await waitFor(() => expect(hardDeleteVault).toHaveBeenCalledWith("main"));
  });

  it("keeps the modal open and shows the error when the action throws", async () => {
    const user = userEvent.setup();
    archiveVault.mockRejectedValue(new Error("archive failed"));
    renderSection("main");

    await user.click(
      screen.getByRole("button", { name: "Archive current vault" }),
    );
    const input = await screen.findByRole("textbox");
    await user.type(input, "ARCHIVE main");
    await user.click(screen.getByRole("button", { name: "Archive vault" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("archive failed");
  });

  it("disables vault actions when no vault is loaded", () => {
    renderSection(null);
    expect(
      screen.getByRole("button", { name: "Archive current vault" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Permanently delete vault" }),
    ).toBeDisabled();
    // Non-vault actions stay available.
    expect(
      screen.getByRole("button", { name: "Reset onboarding" }),
    ).toBeEnabled();
  });

  it("cancelling the modal runs no action", async () => {
    const user = userEvent.setup();
    renderSection("main");
    await user.click(screen.getByRole("button", { name: "Reset onboarding" }));
    await screen.findByRole("textbox");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(resetOnboarding).not.toHaveBeenCalled();
  });
});

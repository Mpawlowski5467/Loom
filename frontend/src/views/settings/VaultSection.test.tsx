import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { VaultSection } from "./VaultSection";
import type { VaultInfo } from "../../api/types";

const {
  listVaults,
  createVault,
  setActiveVault,
  renameVault,
  archiveVault,
  revealVault,
  vaultExportUrl,
} = vi.hoisted(() => ({
  listVaults: vi.fn(),
  createVault: vi.fn(),
  setActiveVault: vi.fn(),
  renameVault: vi.fn(),
  archiveVault: vi.fn(),
  revealVault: vi.fn(),
  vaultExportUrl: vi.fn(() => "http://x/export"),
}));

vi.mock("../../api/vault", () => ({
  listVaults,
  createVault,
  setActiveVault,
  renameVault,
  archiveVault,
  revealVault,
  vaultExportUrl,
}));

function vault(name: string, active = false): VaultInfo {
  return { name, path: `/vaults/${name}`, is_active: active };
}

function renderSection(vaults: VaultInfo[], active: string) {
  const refreshConfig = vi.fn().mockResolvedValue(undefined);
  const value = { refreshConfig } as unknown as AppContextValue;
  listVaults.mockResolvedValue({ vaults, active });
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <VaultSection />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { refreshConfig };
}

beforeEach(() => {
  for (const fn of [
    listVaults,
    createVault,
    setActiveVault,
    renameVault,
    archiveVault,
    revealVault,
  ])
    fn.mockReset();
  vaultExportUrl.mockReturnValue("http://x/export");
  setActiveVault.mockResolvedValue({});
  createVault.mockResolvedValue({});
  renameVault.mockResolvedValue({});
  archiveVault.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VaultSection — listing", () => {
  it("lists vaults and marks the active one", async () => {
    renderSection([vault("main", true), vault("scratch")], "main");
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("scratch")).toBeInTheDocument();
    // The active vault's switch button reads "Active" and is disabled.
    const active = screen.getByRole("button", { name: "Active" });
    expect(active).toBeDisabled();
  });
});

describe("VaultSection — create", () => {
  it("creates a vault, activates it, and refreshes", async () => {
    const user = userEvent.setup();
    const { refreshConfig } = renderSection([vault("main", true)], "main");
    await screen.findByText("main");

    await user.type(screen.getByPlaceholderText("new-vault"), "research");
    await user.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() => expect(createVault).toHaveBeenCalledWith({ name: "research" }));
    expect(setActiveVault).toHaveBeenCalledWith("research");
    expect(refreshConfig).toHaveBeenCalled();
  });

  it("keeps Create disabled until a name is typed", async () => {
    renderSection([vault("main", true)], "main");
    await screen.findByText("main");
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
  });
});

describe("VaultSection — switch", () => {
  it("switches to another vault", async () => {
    const user = userEvent.setup();
    renderSection([vault("main", true), vault("scratch")], "main");
    await screen.findByText("scratch");
    await user.click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(setActiveVault).toHaveBeenCalledWith("scratch"));
  });
});

describe("VaultSection — rename", () => {
  it("rejects an invalid name without calling the API", async () => {
    const user = userEvent.setup();
    renderSection([vault("main", true)], "main");
    await screen.findByText("main");

    await user.click(screen.getByRole("button", { name: /Rename/ }));
    const input = screen.getByDisplayValue("main");
    await user.clear(input);
    await user.type(input, "-bad name{Enter}"); // starts with dash, has space

    expect(await screen.findByText(/Start with a letter or digit/)).toBeInTheDocument();
    expect(renameVault).not.toHaveBeenCalled();
  });

  it("renames with a valid name", async () => {
    const user = userEvent.setup();
    renderSection([vault("main", true)], "main");
    await screen.findByText("main");

    await user.click(screen.getByRole("button", { name: /Rename/ }));
    const input = screen.getByDisplayValue("main");
    await user.clear(input);
    await user.type(input, "main-2{Enter}");

    await waitFor(() => expect(renameVault).toHaveBeenCalledWith("main", "main-2"));
  });
});

describe("VaultSection — delete", () => {
  it("archives only when the typed confirmation matches the name", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("scratch");
    renderSection([vault("main", true), vault("scratch")], "main");
    await screen.findByText("scratch");

    // scratch is non-active so its Delete is enabled.
    const deletes = screen.getAllByRole("button", { name: /Delete/ });
    await user.click(deletes[deletes.length - 1]!);
    await waitFor(() => expect(archiveVault).toHaveBeenCalledWith("scratch"));
  });

  it("does not archive when the confirmation does not match", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("wrong");
    renderSection([vault("main", true), vault("scratch")], "main");
    await screen.findByText("scratch");

    const deletes = screen.getAllByRole("button", { name: /Delete/ });
    await user.click(deletes[deletes.length - 1]!);
    expect(archiveVault).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/did not match/),
    ).toBeInTheDocument();
  });

  it("disables delete for the active vault", async () => {
    renderSection([vault("main", true)], "main");
    await screen.findByText("main");
    expect(screen.getByRole("button", { name: /Delete/ })).toBeDisabled();
  });
});

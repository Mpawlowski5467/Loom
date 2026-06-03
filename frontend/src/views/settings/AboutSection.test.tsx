import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { AboutSection } from "./AboutSection";
import type {
  DiagnosticsResponse,
  HealthResponse,
  IndexStats,
} from "../../api/diagnostics";

const { getDiagnostics, getHealth, getIndexStats, resetOnboarding } =
  vi.hoisted(() => ({
    getDiagnostics: vi.fn(),
    getHealth: vi.fn(),
    getIndexStats: vi.fn(),
    resetOnboarding: vi.fn(),
  }));

vi.mock("../../api/diagnostics", () => ({
  getDiagnostics,
  getHealth,
  getIndexStats,
}));
vi.mock("../../api/onboarding", () => ({ resetOnboarding }));

const DIAG: DiagnosticsResponse = {
  app_version: "1.2.3",
  python_version: "3.12.0",
  vault_path: "/home/u/.loom/vaults/main",
  providers_configured: ["openai", "ollama"],
  started_at: "2026-05-30T10:00:00Z",
  build_date: null,
  log_path: "/home/u/.loom/logs",
};

const HEALTH: HealthResponse = {
  ok: true,
  components: {
    index: { ready: true, count: 42 },
    provider: { ready: false, details: "no key" },
  },
} as HealthResponse;

const INDEX_STATS: IndexStats = {
  ready: true,
  total_chunks: 128,
  distinct_notes: 37,
  unindexed_count: 2,
  avg_chunks_per_note: 3.5,
  type_breakdown: { topic: 80, project: 30, daily: 18 },
};

const INDEX_EMPTY: IndexStats = {
  ready: false,
  total_chunks: 0,
  distinct_notes: 0,
  unindexed_count: 4,
  avg_chunks_per_note: 0,
  type_breakdown: {},
};

function renderSection() {
  const refreshConfig = vi.fn().mockResolvedValue(undefined);
  const value = { refreshConfig } as unknown as AppContextValue;
  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <AboutSection />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { refreshConfig };
}

beforeEach(() => {
  getDiagnostics.mockReset().mockResolvedValue(DIAG);
  getHealth.mockReset().mockResolvedValue(HEALTH);
  getIndexStats.mockReset().mockResolvedValue(INDEX_STATS);
  resetOnboarding.mockReset().mockResolvedValue(undefined);
});

describe("AboutSection", () => {
  it("renders diagnostics once loaded", async () => {
    renderSection();
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("3.12.0")).toBeInTheDocument();
    expect(screen.getByText("openai, ollama")).toBeInTheDocument();
    expect(screen.getByText("/home/u/.loom/vaults/main")).toBeInTheDocument();
  });

  it("shows the backend health pill and per-component status", async () => {
    renderSection();
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("index")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("provider")).toBeInTheDocument();
    expect(screen.getByText("no key")).toBeInTheDocument();
  });

  it("copies the vault path to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderSection();
    await screen.findByText("1.2.3");

    await user.click(screen.getByRole("button", { name: /Copy path/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/home/u/.loom/vaults/main"),
    );
    expect(await screen.findByText("Vault path copied.")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("re-runs onboarding after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { refreshConfig } = renderSection();
    await screen.findByText("1.2.3");

    await user.click(screen.getByRole("button", { name: /Re-run onboarding/ }));
    await waitFor(() => expect(resetOnboarding).toHaveBeenCalled());
    expect(refreshConfig).toHaveBeenCalled();
  });

  it("does not re-run onboarding when the confirm is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSection();
    await screen.findByText("1.2.3");
    await user.click(screen.getByRole("button", { name: /Re-run onboarding/ }));
    expect(resetOnboarding).not.toHaveBeenCalled();
  });

  it("surfaces a diagnostics load failure", async () => {
    getDiagnostics.mockRejectedValue(new Error("backend down"));
    renderSection();
    expect(await screen.findByText("backend down")).toBeInTheDocument();
  });

  it("renders the search-index stats and type breakdown when populated", async () => {
    renderSection();
    expect(await screen.findByText("Vector index")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument(); // total chunks
    expect(screen.getByText("37")).toBeInTheDocument(); // distinct notes
    expect(screen.getByText("3.5")).toBeInTheDocument(); // avg chunks/note
    // Type breakdown rows.
    expect(screen.getByText("topic")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("project")).toBeInTheDocument();
  });

  it("shows a not-indexed hint when the index is empty", async () => {
    getIndexStats.mockResolvedValue(INDEX_EMPTY);
    renderSection();
    await screen.findByText("Vector index");
    expect(screen.getByText(/No vector index yet/)).toBeInTheDocument();
    expect(screen.getByText(/4 note\(s\) await indexing/)).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { BoardView } from "./BoardView";

vi.mock("./board/AgentsSection", () => ({
  AgentsSection: () => <section aria-label="Agent cards" />,
}));
vi.mock("./board/PulseMode", () => ({
  PulseMode: () => <ul aria-label="Agent pulse lines" />,
}));
vi.mock("./board/council/CouncilPanel", () => ({
  CouncilPanel: () => <aside aria-label="Loom Council" />,
}));
vi.mock("@/api/changelog", async (orig) => ({
  ...(await orig<typeof import("@/api/changelog")>()),
  fetchChangelogFeed: vi.fn(async () => [
    {
      id: "a",
      ts: new Date().toISOString(),
      agent: "sentinel",
      action: "validated",
      target: "",
      chain: "ok",
      sentinel: "ok",
    },
    {
      id: "b",
      ts: new Date().toISOString(),
      agent: "sentinel",
      action: "validated",
      target: "",
      chain: "ok",
      sentinel: "warn",
    },
  ]),
}));
vi.mock("@/api/automations", () => ({
  getStandupAutomation: vi.fn(async () => ({
    schedule: { enabled: true, run_time: "08:00", timezone: "UTC" },
    calendar: {},
    status: {
      paused: false,
      next_run_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
    },
  })),
}));
vi.mock("@/api/captures", async (orig) => ({
  ...(await orig<typeof import("@/api/captures")>()),
  getCaptureProcessingPolicy: vi.fn(async () => ({ mode: "manual" })),
}));

function renderBoard() {
  const ctx = {
    changelog: [],
    notes: [],
    captures: [{ id: "c1", status: "needs_review" }],
    councilPrefill: null,
  } as unknown as AppContextValue;
  render(
    <MemoryRouter>
      <AppCtx.Provider value={ctx}>
        <BoardView />
      </AppCtx.Provider>
    </MemoryRouter>,
  );
}

describe("BoardView", () => {
  beforeEach(() => localStorage.clear());

  it("has the title, the promise and the Council beside the board", () => {
    renderBoard();
    expect(
      screen.getByRole("heading", { level: 1, name: "Board" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every action goes through the read chain and Sentinel/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Loom Council" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Agent cards" }),
    ).toBeInTheDocument();
  });

  it("shows stats from the feed, flags and the schedule", async () => {
    renderBoard();
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(
      screen.getByText("2 reviews · 1 warning · 0 failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 notes · 1 capture")).toBeInTheDocument();
    expect(await screen.findByText(/Standup in 3 h/)).toBeInTheDocument();
  });

  it("switches the agents to the pulse view", async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(screen.getByRole("radio", { name: "Pulse" }));
    expect(
      screen.getByRole("list", { name: "Agent pulse lines" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Agent cards" })).toBeNull();
  });
});

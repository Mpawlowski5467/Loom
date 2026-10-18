import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { TodayView } from "./TodayView";

const { listCaptureJobs } = vi.hoisted(() => ({ listCaptureJobs: vi.fn() }));
vi.mock("../api/captures", () => ({ listCaptureJobs }));

function renderToday(vault = "one") {
  render(
    <AppCtx.Provider
      value={
        {
          notes: [],
          captures: [],
          config: { active_vault: vault },
          openNote: vi.fn(),
          setTab: vi.fn(),
        } as unknown as AppContextValue
      }
    >
      <TodayView />
    </AppCtx.Provider>,
  );
}

describe("TodayView", () => {
  it("reports failed job loading instead of a false zero", async () => {
    listCaptureJobs.mockRejectedValueOnce(new Error("offline"));
    renderToday();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load jobs.",
    );
  });

  it("keeps job results keyed to the current vault", async () => {
    let resolve!: (jobs: unknown[]) => void;
    listCaptureJobs
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce([]);
    const { rerender } = render(
      <AppCtx.Provider
        value={
          {
            notes: [],
            captures: [],
            config: { active_vault: "one" },
            openNote: vi.fn(),
            setTab: vi.fn(),
          } as unknown as AppContextValue
        }
      >
        <TodayView />
      </AppCtx.Provider>,
    );
    rerender(
      <AppCtx.Provider
        value={
          {
            notes: [],
            captures: [],
            config: { active_vault: "two" },
            openNote: vi.fn(),
            setTab: vi.fn(),
          } as unknown as AppContextValue
        }
      >
        <TodayView />
      </AppCtx.Provider>,
    );
    resolve([{ status: "failed", recommended_action: "Retry" }]);
    await waitFor(() =>
      expect(screen.getByText("Failed jobs").parentElement).toHaveTextContent(
        "0",
      ),
    );
  });
});

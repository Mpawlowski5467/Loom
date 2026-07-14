import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStandupAutomation,
  syncCalendar,
  testCalendar,
  updateStandupAutomation,
  type StandupAutomation,
} from "../../api/automations";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { ConnectionsSection } from "./ConnectionsSection";

vi.mock("../../api/automations", () => ({
  getStandupAutomation: vi.fn(),
  updateStandupAutomation: vi.fn(),
  testCalendar: vi.fn(),
  syncCalendar: vi.fn(),
}));

const automation: StandupAutomation = {
  schedule: { enabled: false, run_time: "08:00", timezone: "America/Chicago" },
  calendar: {
    enabled: false,
    feed_url_set: false,
    name: "Calendar",
    include_in_standup: true,
    create_captures: true,
  },
  status: {
    running: false,
    paused: false,
    next_run_at: "",
    state: {
      scheduled_date: "",
      attempts: 0,
      last_attempt_at: "",
      last_success_date: "",
      last_success_at: "",
      last_error: "",
      last_capture_id: "",
      last_capture_path: "",
    },
  },
};

function renderSection(pushToast = vi.fn()) {
  return render(
    <AppCtx.Provider value={{ pushToast } as unknown as AppContextValue}>
      <ConnectionsSection />
    </AppCtx.Provider>,
  );
}

describe("ConnectionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStandupAutomation).mockResolvedValue(automation);
    vi.mocked(updateStandupAutomation).mockResolvedValue(automation);
    vi.mocked(testCalendar).mockResolvedValue({
      date: "2026-07-14",
      event_count: 1,
      events: [
        {
          external_id: "calendar:one",
          title: "Planning",
          start: "2026-07-14T09:00:00-05:00",
          end: "2026-07-14T10:00:00-05:00",
          all_day: false,
          location: "Room 4",
        },
      ],
    });
    vi.mocked(syncCalendar).mockResolvedValue({
      date: "2026-07-14",
      event_count: 1,
      created: 1,
      deduplicated: 0,
      capture_ids: ["thr_one"],
    });
  });

  it("loads the saved automation state", async () => {
    renderSection();
    expect(
      await screen.findByDisplayValue("America/Chicago"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Calendar feed" }),
    ).toBeInTheDocument();
  });

  it("saves schedule and private feed settings", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByDisplayValue("America/Chicago");
    await user.click(
      screen.getByRole("checkbox", { name: "Schedule daily Standup" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Enable calendar connection" }),
    );
    await user.type(
      screen.getByPlaceholderText("webcal://… or https://…"),
      "https://calendar.example/private.ics",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateStandupAutomation).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: expect.objectContaining({ enabled: true }),
          calendar: expect.objectContaining({
            enabled: true,
            feed_url: "https://calendar.example/private.ics",
          }),
        }),
      ),
    );
  });

  it("tests the feed and renders its event preview", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByDisplayValue("America/Chicago");
    await user.type(
      screen.getByPlaceholderText("webcal://… or https://…"),
      "https://calendar.example/private.ics",
    );
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("1 event found")).toBeInTheDocument();
    expect(screen.getByText(/Planning/)).toBeInTheDocument();
    expect(testCalendar).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(AbortSignal),
    );
  });

  it("aborts an in-flight calendar test when settings unmounts", async () => {
    const user = userEvent.setup();
    vi.mocked(testCalendar).mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderSection();
    await screen.findByDisplayValue("America/Chicago");
    await user.type(
      screen.getByPlaceholderText("webcal://… or https://…"),
      "https://calendar.example/private.ics",
    );
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(testCalendar).toHaveBeenCalled());
    const signal = vi.mocked(testCalendar).mock.calls[0]?.[1];

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

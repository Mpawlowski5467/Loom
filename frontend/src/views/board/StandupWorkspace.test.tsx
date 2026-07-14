import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateStandup,
  getStandupAutomation,
  syncCalendar,
  type StandupAutomation,
} from "../../api/automations";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { StandupWorkspace } from "./StandupWorkspace";

vi.mock("../../api/automations", () => ({
  generateStandup: vi.fn(),
  getStandupAutomation: vi.fn(),
  syncCalendar: vi.fn(),
}));

const automation: StandupAutomation = {
  schedule: { enabled: true, run_time: "08:00", timezone: "America/Chicago" },
  calendar: {
    enabled: true,
    feed_url_set: true,
    name: "Work",
    include_in_standup: true,
    create_captures: true,
  },
  status: {
    running: false,
    paused: false,
    next_run_at: "2026-07-15T08:00:00-05:00",
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

function renderWorkspace() {
  const onClose = vi.fn();
  const selectCapture = vi.fn();
  const setTab = vi.fn();
  const value = {
    pushToast: vi.fn(),
    selectCapture,
    setTab,
  } as unknown as AppContextValue;
  const rendered = render(
    <AppCtx.Provider value={value}>
      <StandupWorkspace onClose={onClose} />
    </AppCtx.Provider>,
  );
  return { onClose, selectCapture, setTab, unmount: rendered.unmount };
}

describe("StandupWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStandupAutomation).mockResolvedValue(automation);
    vi.mocked(syncCalendar).mockResolvedValue({
      date: "2026-07-14",
      event_count: 1,
      created: 1,
      deduplicated: 0,
      capture_ids: ["thr_event"],
    });
    vi.mocked(generateStandup).mockResolvedValue({
      recap: "## Highlights\n\n- Planned the launch",
      date: "2026-07-14",
      notes_modified: 3,
      calendar_events: 1,
      calendar_error: "",
      capture_id: "thr_standup",
      capture_path: "/vault/threads/captures/standup-2026-07-14.md",
    });
  });

  it("syncs connected calendar events before generating", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    expect(await screen.findByText("Work connected")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-07-14");
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    expect(await screen.findByText("Planned the launch")).toBeInTheDocument();
    expect(syncCalendar).toHaveBeenCalledWith(
      "2026-07-14",
      expect.any(AbortSignal),
    );
    const signal = vi.mocked(syncCalendar).mock.calls[0]?.[1];
    expect(generateStandup).toHaveBeenCalledWith("2026-07-14", signal);
  });

  it("opens the generated capture in Inbox", async () => {
    const user = userEvent.setup();
    const { onClose, selectCapture, setTab } = renderWorkspace();
    await screen.findByText("Work connected");
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    await user.click(
      await screen.findByRole("button", { name: "Open in Inbox" }),
    );
    expect(selectCapture).toHaveBeenCalledWith("thr_standup");
    expect(setTab).toHaveBeenCalledWith("inbox");
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces an automation failure", async () => {
    const user = userEvent.setup();
    vi.mocked(syncCalendar).mockRejectedValue(
      new Error("Calendar feed timed out"),
    );
    renderWorkspace();
    await screen.findByText("Work connected");
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Calendar feed timed out",
      ),
    );
    expect(generateStandup).not.toHaveBeenCalled();
  });

  it("aborts an in-flight generation when the workspace unmounts", async () => {
    const user = userEvent.setup();
    vi.mocked(generateStandup).mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderWorkspace();
    await screen.findByText("Work connected");
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    await waitFor(() => expect(generateStandup).toHaveBeenCalled());
    const signal = vi.mocked(generateStandup).mock.calls[0]?.[1];

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

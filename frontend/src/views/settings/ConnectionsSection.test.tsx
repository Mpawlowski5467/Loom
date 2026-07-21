import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEmailAutomation,
  getGitHubAutomation,
  getStandupAutomation,
  syncCalendar,
  syncEmail,
  syncGitHub,
  testCalendar,
  testEmail,
  testGitHub,
  updateEmailAutomation,
  updateGitHubAutomation,
  updateStandupAutomation,
  type EmailAutomation,
  type GitHubAutomation,
  type StandupAutomation,
} from "../../api/automations";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { ConnectionsSection } from "./ConnectionsSection";

vi.mock("../../api/automations", () => ({
  getStandupAutomation: vi.fn(),
  updateStandupAutomation: vi.fn(),
  testCalendar: vi.fn(),
  syncCalendar: vi.fn(),
  getGitHubAutomation: vi.fn(),
  updateGitHubAutomation: vi.fn(),
  testGitHub: vi.fn(),
  syncGitHub: vi.fn(),
  getEmailAutomation: vi.fn(),
  updateEmailAutomation: vi.fn(),
  testEmail: vi.fn(),
  syncEmail: vi.fn(),
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

const githubAutomation: GitHubAutomation = {
  github: {
    enabled: false,
    token_set: false,
    repos: ["octocat/hello-world"],
    interval_minutes: 15,
    lookback_hours: 24,
    include_commits: true,
    include_issues: true,
    include_pull_requests: true,
  },
  status: {
    running: false,
    last_run: "",
    last_error: "",
    last_created: 0,
  },
};

const emailAutomation: EmailAutomation = {
  email: {
    enabled: false,
    host: "imap.example.com",
    port: 993,
    use_ssl: true,
    username: "you@example.com",
    password_set: false,
    folder: "INBOX",
    interval_minutes: 15,
    lookback_hours: 24,
    max_messages_per_poll: 25,
  },
  status: {
    running: false,
    last_run: "",
    last_error: "",
    last_created: 0,
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
    vi.mocked(getGitHubAutomation).mockResolvedValue(githubAutomation);
    vi.mocked(updateGitHubAutomation).mockResolvedValue(githubAutomation);
    vi.mocked(testGitHub).mockResolvedValue({ repos: [] });
    vi.mocked(syncGitHub).mockResolvedValue({
      synced_at: "2026-07-14T10:00:00Z",
      repos: [],
      created: 0,
      deduplicated: 0,
      errors: 0,
    });
    vi.mocked(getEmailAutomation).mockResolvedValue(emailAutomation);
    vi.mocked(updateEmailAutomation).mockResolvedValue(emailAutomation);
    vi.mocked(testEmail).mockResolvedValue({
      ok: true,
      folder: "INBOX",
      messages: 12,
      error: "",
    });
    vi.mocked(syncEmail).mockResolvedValue({
      synced_at: "2026-07-14T10:00:00Z",
      folder: "INBOX",
      fetched: 0,
      created: 0,
      deduplicated: 0,
      capture_ids: [],
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

  it("renders the GitHub card with a redacted saved token", async () => {
    vi.mocked(getGitHubAutomation).mockResolvedValue({
      ...githubAutomation,
      github: { ...githubAutomation.github, token_set: true },
    });
    renderSection();
    expect(
      await screen.findByRole("heading", { name: "GitHub bridge" }),
    ).toBeInTheDocument();
    expect(screen.getByText("token saved")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("ghp_… (leave blank to keep current)"),
    ).toHaveValue("");
  });

  it("saves GitHub settings with repos serialized from lines", async () => {
    const user = userEvent.setup();
    renderSection();
    const reposInput = await screen.findByPlaceholderText(
      /octocat\/hello-world/,
    );
    await user.type(reposInput, "{enter}mpawlowski/loom");
    await user.click(
      screen.getByRole("checkbox", { name: "Enable GitHub connection" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save GitHub settings" }),
    );
    await waitFor(() =>
      expect(updateGitHubAutomation).toHaveBeenCalledWith({
        enabled: true,
        repos: ["octocat/hello-world", "mpawlowski/loom"],
        interval_minutes: 15,
        lookback_hours: 24,
        include_commits: true,
        include_issues: true,
        include_pull_requests: true,
      }),
    );
  });

  it("tests GitHub repos and renders per-repo results", async () => {
    const user = userEvent.setup();
    vi.mocked(testGitHub).mockResolvedValue({
      repos: [
        {
          repo: "octocat/hello-world",
          ok: true,
          private: false,
          description: "Hello World",
          default_branch: "main",
          pushed_at: "",
          error: "",
        },
        {
          repo: "octocat/missing",
          ok: false,
          private: false,
          description: "",
          default_branch: "",
          pushed_at: "",
          error: "Not Found",
        },
      ],
    });
    renderSection();
    await screen.findByDisplayValue("octocat/hello-world");
    await user.click(
      screen.getByRole("button", { name: "Test GitHub connection" }),
    );
    expect(
      await screen.findByText("1 of 2 repos reachable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("✓ octocat/hello-world — Hello World"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("✗ octocat/missing — Not Found"),
    ).toBeInTheDocument();
    expect(testGitHub).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("syncs GitHub and reports created captures and repo errors", async () => {
    const user = userEvent.setup();
    const pushToast = vi.fn();
    vi.mocked(syncGitHub).mockResolvedValue({
      synced_at: "2026-07-14T10:00:00Z",
      repos: [
        {
          repo: "octocat/hello-world",
          fetched: 5,
          created: 3,
          deduplicated: 2,
          error: "",
        },
        {
          repo: "octocat/private",
          fetched: 0,
          created: 0,
          deduplicated: 0,
          error: "Not Found",
        },
      ],
      created: 3,
      deduplicated: 2,
      errors: 1,
    });
    renderSection(pushToast);
    await screen.findByDisplayValue("octocat/hello-world");
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "GitHub sync: 3 new captures, 2 already in Inbox",
        }),
      ),
    );
    expect(
      await screen.findByText("octocat/private: Not Found"),
    ).toBeInTheDocument();
  });

  it("surfaces the enabled-without-repos 422 as an inline error", async () => {
    const user = userEvent.setup();
    vi.mocked(getGitHubAutomation).mockResolvedValue({
      ...githubAutomation,
      github: { ...githubAutomation.github, enabled: true, repos: [] },
    });
    vi.mocked(updateGitHubAutomation).mockRejectedValue(
      new Error("At least one repository is required when enabled"),
    );
    renderSection();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save GitHub settings" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Save GitHub settings" }),
    );
    expect(
      await screen.findByText(
        "At least one repository is required when enabled",
      ),
    ).toBeInTheDocument();
  });

  it("renders the Email card with a redacted saved password", async () => {
    vi.mocked(getEmailAutomation).mockResolvedValue({
      ...emailAutomation,
      email: { ...emailAutomation.email, password_set: true },
    });
    renderSection();
    expect(
      await screen.findByRole("heading", { name: "Email bridge" }),
    ).toBeInTheDocument();
    expect(screen.getByText("password saved")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Leave blank to keep current"),
    ).toHaveValue("");
  });

  it("saves Email settings with the typed password", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByDisplayValue("imap.example.com");
    await user.type(screen.getByPlaceholderText("App password"), "s3cret");
    await user.click(
      screen.getByRole("checkbox", { name: "Enable email connection" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save email settings" }),
    );
    await waitFor(() =>
      expect(updateEmailAutomation).toHaveBeenCalledWith({
        enabled: true,
        host: "imap.example.com",
        port: 993,
        use_ssl: true,
        username: "you@example.com",
        folder: "INBOX",
        interval_minutes: 15,
        lookback_hours: 24,
        max_messages_per_poll: 25,
        password: "s3cret",
      }),
    );
  });

  it("tests the Email connection and renders the inline result", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByDisplayValue("imap.example.com");
    await user.type(screen.getByPlaceholderText("App password"), "s3cret");
    await user.click(
      screen.getByRole("button", { name: "Test email connection" }),
    );
    expect(
      await screen.findByText("Connected — INBOX has 12 messages"),
    ).toBeInTheDocument();
    expect(testEmail).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("renders a failed Email test inline without a success toast", async () => {
    const user = userEvent.setup();
    const pushToast = vi.fn();
    vi.mocked(testEmail).mockResolvedValue({
      ok: false,
      folder: "",
      messages: 0,
      error: "authentication failed",
    });
    renderSection(pushToast);
    await screen.findByDisplayValue("imap.example.com");
    await user.type(screen.getByPlaceholderText("App password"), "wrong");
    await user.click(
      screen.getByRole("button", { name: "Test email connection" }),
    );
    expect(
      await screen.findByText("authentication failed"),
    ).toBeInTheDocument();
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Email connected"),
      }),
    );
  });

  it("syncs Email and toasts the created count", async () => {
    const user = userEvent.setup();
    const pushToast = vi.fn();
    vi.mocked(syncEmail).mockResolvedValue({
      synced_at: "2026-07-14T10:00:00Z",
      folder: "INBOX",
      fetched: 6,
      created: 4,
      deduplicated: 1,
      capture_ids: ["thr_a", "thr_b", "thr_c", "thr_d"],
    });
    renderSection(pushToast);
    await screen.findByDisplayValue("imap.example.com");
    await user.type(screen.getByPlaceholderText("App password"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Sync email now" }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Email sync: 4 new captures, 1 already in Inbox",
        }),
      ),
    );
  });

  it("surfaces the enable-incomplete 422 as an inline error", async () => {
    const user = userEvent.setup();
    vi.mocked(getEmailAutomation).mockResolvedValue({
      ...emailAutomation,
      email: {
        ...emailAutomation.email,
        enabled: true,
        host: "",
        username: "",
      },
    });
    vi.mocked(updateEmailAutomation).mockRejectedValue(
      new Error("IMAP host, username, and password are required when enabled"),
    );
    renderSection();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save email settings" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Save email settings" }),
    );
    expect(
      await screen.findByText(
        "IMAP host, username, and password are required when enabled",
      ),
    ).toBeInTheDocument();
  });
});

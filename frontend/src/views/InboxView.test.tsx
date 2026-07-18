import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { InboxView } from "./InboxView";
import type { Capture } from "../data/types";
import type { CaptureJob, CapturePreview, CommitResult } from "../api/captures";
import { ApiError } from "../api/client";

// --- Mock the captures API: InboxView drives all backend I/O through it. ---
const {
  previewCapture,
  commitCapture,
  processCapture,
  skipCapture,
  listCaptureJobs,
  enqueueCaptureJob,
  enqueueCaptureJobs,
  cancelCaptureJob,
  retryCaptureJob,
  pruneCaptureJobHistory,
  getCaptureProcessingPolicy,
  updateCaptureProcessingPolicy,
} = vi.hoisted(() => ({
  previewCapture: vi.fn(),
  commitCapture: vi.fn(),
  processCapture: vi.fn(),
  skipCapture: vi.fn(),
  listCaptureJobs: vi.fn(),
  enqueueCaptureJob: vi.fn(),
  enqueueCaptureJobs: vi.fn(),
  cancelCaptureJob: vi.fn(),
  retryCaptureJob: vi.fn(),
  pruneCaptureJobHistory: vi.fn(),
  getCaptureProcessingPolicy: vi.fn(),
  updateCaptureProcessingPolicy: vi.fn(),
}));

vi.mock("../api/captures", async (importOriginal) => {
  // Keep the real pure helpers (captureRelPath); stub only the network calls.
  const actual = await importOriginal<typeof import("../api/captures")>();
  return {
    ...actual,
    previewCapture,
    commitCapture,
    processCapture,
    skipCapture,
    listCaptureJobs,
    enqueueCaptureJob,
    enqueueCaptureJobs,
    cancelCaptureJob,
    retryCaptureJob,
    pruneCaptureJobHistory,
    getCaptureProcessingPolicy,
    updateCaptureProcessingPolicy,
  };
});

function mkCapture(overrides: Partial<Capture> = {}): Capture {
  const id = overrides.id ?? "cap_1";
  return {
    id,
    title: "Meeting notes",
    folder: "captures",
    body: "Some captured text",
    receivedAt: "2026-05-20T14:30:00Z",
    status: "pending",
    // Default the on-disk path to match the id so captureRelPath is predictable.
    filePath: `/v/threads/captures/${id}.md`,
    ...overrides,
  };
}

/** A fully-populated backend note record (backendNoteToFrontend reads every field). */
function mkNoteRecord(
  overrides: Partial<CommitResult["note"]> = {},
): CommitResult["note"] {
  return {
    id: "thr_new",
    title: "Filed Title",
    type: "topic",
    tags: [],
    created: "2026-05-20T14:30:00Z",
    modified: "2026-05-20T14:30:00Z",
    author: "agent:weaver",
    source: "capture:cap_1",
    links: [],
    status: "active",
    history: [],
    file_path: "/v/threads/topics/filed.md",
    body: "preview body",
    wikilinks: [],
    ...overrides,
  } as CommitResult["note"];
}

/** Title text inside list rows only (the detail pane also renders the title). */
function listTitles(): string[] {
  return Array.from(document.querySelectorAll(".inbox-card-title")).map(
    (el) => el.textContent ?? "",
  );
}

function mkPreview(overrides: Partial<CapturePreview> = {}): CapturePreview {
  return {
    note_type: "topic",
    folder: "topics",
    title: "Filed Title",
    tags: ["a"],
    body: "preview body",
    links: [],
    ...overrides,
  };
}

function mkJob(overrides: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: "job_1",
    capture_id: "cap_1",
    capture_path: "captures/cap_1.md",
    source: "manual",
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    outcome: null,
    created_at: "2026-05-20T14:31:00Z",
    updated_at: "2026-05-20T14:31:00Z",
    ...overrides,
  };
}

/** Spies the test inspects after interactions. */
interface Spies {
  selectCapture: ReturnType<typeof vi.fn>;
  setCaptureStatus: ReturnType<typeof vi.fn>;
  removeCapture: ReturnType<typeof vi.fn>;
  pushToast: ReturnType<typeof vi.fn>;
  appendNote: ReturnType<typeof vi.fn>;
  openNote: ReturnType<typeof vi.fn>;
}

function renderInbox(
  captures: Capture[],
  opts: {
    selectedCaptureId?: string | null;
    capturesLoaded?: boolean;
    capturesError?: string | null;
  } = {},
): Spies {
  const spies: Spies = {
    selectCapture: vi.fn(),
    setCaptureStatus: vi.fn(),
    removeCapture: vi.fn(),
    pushToast: vi.fn(),
    appendNote: vi.fn(),
    openNote: vi.fn(),
  };

  const value = {
    notes: [],
    captures,
    capturesLoaded: opts.capturesLoaded ?? true,
    capturesError: opts.capturesError ?? null,
    selectedCaptureId: opts.selectedCaptureId ?? null,
    noteById: () => undefined,
    ...spies,
  } as unknown as AppContextValue;

  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <InboxView />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return spies;
}

beforeEach(() => {
  window.localStorage.removeItem("loom.demoMode");
  previewCapture.mockReset();
  commitCapture.mockReset();
  processCapture.mockReset();
  skipCapture.mockReset();
  listCaptureJobs.mockReset();
  enqueueCaptureJob.mockReset();
  enqueueCaptureJobs.mockReset();
  cancelCaptureJob.mockReset();
  retryCaptureJob.mockReset();
  pruneCaptureJobHistory.mockReset().mockResolvedValue({ deleted: 0 });
  getCaptureProcessingPolicy.mockReset();
  updateCaptureProcessingPolicy.mockReset();
  listCaptureJobs.mockResolvedValue([]);
  getCaptureProcessingPolicy.mockResolvedValue({
    mode: "manual",
    trusted_sources: [],
    concurrency: 1,
    max_retries: 2,
    base_backoff_seconds: 5,
  });
  // Default: previews never resolve unless a test opts in.
  previewCapture.mockReturnValue(new Promise(() => {}));
});

describe("InboxView — listing & filtering", () => {
  it("lists captures and shows the non-done count", () => {
    renderInbox([
      mkCapture({ id: "a", title: "Alpha" }),
      mkCapture({ id: "b", title: "Beta", status: "done" }),
    ]);
    expect(listTitles()).toContain("Alpha");
    expect(listTitles()).toContain("Beta");
    // One of two is not done → pending count 1.
    expect(document.querySelector(".inbox-count")?.textContent).toBe("1");
  });

  it("filters the list by the search query", async () => {
    const user = userEvent.setup();
    renderInbox([
      mkCapture({ id: "a", title: "Alpha note" }),
      mkCapture({ id: "b", title: "Beta note" }),
    ]);
    await user.type(screen.getByLabelText("Search captures"), "alpha");
    expect(listTitles()).toEqual(["Alpha note"]);
  });

  it("shows and searches capture source and provenance", async () => {
    const user = userEvent.setup();
    renderInbox(
      [
        mkCapture({
          id: "mail",
          title: "Imported message",
          source: "bridge:gmail",
          provenance: { sender: "ada@example.com" },
        }),
      ],
      // Selected so the detail pane renders the provenance.
      { selectedCaptureId: "mail" },
    );

    expect(screen.getByText("bridge:gmail")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Search captures"),
      "ada@example.com",
    );
    expect(listTitles()).toEqual(["Imported message"]);
  });

  it("shows the empty-inbox state with no captures", () => {
    renderInbox([]);
    expect(screen.getByText("Inbox is clear")).toBeInTheDocument();
  });

  it("shows a loading state before captures have loaded", () => {
    renderInbox([], { capturesLoaded: false });
    expect(screen.getByText("Loading captures…")).toBeInTheDocument();
    // Must NOT claim the inbox is clear mid-fetch.
    expect(screen.queryByText("Inbox is clear")).not.toBeInTheDocument();
  });

  it("shows an error state when the captures fetch failed", () => {
    renderInbox([], {
      capturesLoaded: true,
      capturesError: "Network error",
    });
    expect(screen.getByText("Couldn’t load captures")).toBeInTheDocument();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
    expect(screen.queryByText("Inbox is clear")).not.toBeInTheDocument();
  });

  it("shows a no-match message when the filter excludes everything", async () => {
    const user = userEvent.setup();
    renderInbox([mkCapture({ id: "a", title: "Alpha" })]);
    await user.type(screen.getByLabelText("Search captures"), "zzz");
    expect(screen.getByText(/No captures match/)).toBeInTheDocument();
  });
});

describe("InboxView — background processing", () => {
  it("does not call job APIs for a persisted demo session", async () => {
    window.localStorage.setItem("loom.demoMode", "1");
    const demoCapture = mkCapture({
      filePath: undefined,
      suggestion: {
        type: "topic",
        destFolder: "topics",
        tags: [],
        links: [],
        title: "Demo suggestion",
      },
    });
    renderInbox([demoCapture], { selectedCaptureId: demoCapture.id });

    expect(
      screen.getByRole("combobox", { name: "Auto-process" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "queue processing" }),
    ).toBeNull();
    expect(listCaptureJobs).not.toHaveBeenCalled();
    expect(getCaptureProcessingPolicy).not.toHaveBeenCalled();
    expect(enqueueCaptureJob).not.toHaveBeenCalled();
  });

  it("loads and saves the trusted-source policy", async () => {
    const user = userEvent.setup();
    const trustedPolicy = {
      mode: "trusted" as const,
      trusted_sources: ["bridge:gmail"],
      concurrency: 1,
      max_retries: 2,
      base_backoff_seconds: 5,
    };
    getCaptureProcessingPolicy.mockResolvedValue(trustedPolicy);
    updateCaptureProcessingPolicy.mockImplementation(async (update) => ({
      ...trustedPolicy,
      ...update,
    }));
    renderInbox([]);

    const input = await screen.findByLabelText("Auto-process source names");
    expect(input).toHaveValue("bridge:gmail");
    await user.clear(input);
    await user.type(input, "bridge:gmail, agent:researcher, bridge:gmail");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateCaptureProcessingPolicy).toHaveBeenCalledWith({
        trusted_sources: ["bridge:gmail", "agent:researcher"],
      }),
    );
  });

  it("switches auto-processing from manual to all captures", async () => {
    const user = userEvent.setup();
    updateCaptureProcessingPolicy.mockResolvedValue({
      mode: "all",
      trusted_sources: [],
      concurrency: 1,
      max_retries: 2,
      base_backoff_seconds: 5,
    });
    renderInbox([]);

    const policy = screen.getByRole("combobox", { name: "Auto-process" });
    await waitFor(() => expect(policy).toBeEnabled());
    await user.selectOptions(policy, "all");
    await waitFor(() =>
      expect(updateCaptureProcessingPolicy).toHaveBeenCalledWith({
        mode: "all",
      }),
    );
    expect(policy).toHaveValue("all");
  });

  it("renders a durable queued job and allows cancellation before it runs", async () => {
    const user = userEvent.setup();
    const queued = mkJob();
    listCaptureJobs.mockResolvedValue([queued]);
    cancelCaptureJob.mockResolvedValue({ ...queued, status: "cancelled" });
    retryCaptureJob.mockResolvedValue(queued);
    renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    const cancel = await screen.findByRole("button", { name: "cancel job" });
    expect(screen.getByLabelText("Select Meeting notes")).toBeDisabled();
    expect(previewCapture).not.toHaveBeenCalled();
    await user.click(cancel);

    await waitFor(() => expect(cancelCaptureJob).toHaveBeenCalledWith("job_1"));
    expect(await screen.findByText("Processing cancelled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "queue again" }));
    await waitFor(() => expect(retryCaptureJob).toHaveBeenCalledWith("job_1"));
  });

  it("drops stale bulk selection when a capture becomes active", async () => {
    const user = userEvent.setup();
    let resolveJobs: (jobs: CaptureJob[]) => void = () => {};
    listCaptureJobs.mockReturnValue(
      new Promise<CaptureJob[]>((resolve) => {
        resolveJobs = resolve;
      }),
    );
    renderInbox([mkCapture()]);

    await user.click(screen.getByLabelText("Select Meeting notes"));
    expect(screen.getByRole("button", { name: "Queue" })).toBeEnabled();
    resolveJobs([mkJob({ status: "running" })]);

    await waitFor(() =>
      expect(screen.getByLabelText("Select Meeting notes")).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
  });

  it("shows retry timing and the last error while a job backs off", async () => {
    listCaptureJobs.mockResolvedValue([
      mkJob({
        status: "retrying",
        attempts: 1,
        next_attempt_at: "2026-05-20T14:35:00Z",
        error: "Provider timed out",
      }),
    ]);
    renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    expect(await screen.findByText("Attempt 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Provider timed out")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "cancel retry" }),
    ).toBeInTheDocument();
  });

  it("shows completed job-only history after the source capture is archived", async () => {
    const user = userEvent.setup();
    listCaptureJobs.mockResolvedValue([
      mkJob({
        status: "completed",
        capture_id: "archived-capture",
        capture_path: "/v/threads/captures/archived-capture.md",
        attempts: 1,
        outcome: "filed",
        note_id: "note-1",
        note_title: "Filed note",
      }),
    ]);
    const spies = renderInbox([]);

    await user.click(await screen.findByRole("tab", { name: /Jobs 1/ }));
    await user.click(screen.getByRole("tab", { name: /History 1/ }));

    expect(
      screen.getByRole("heading", { name: "archived-capture" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open note" }));
    expect(spies.openNote).toHaveBeenCalledWith("note-1");
  });
});

describe("InboxView — preview & accept", () => {
  it("fetches a preview for the selected capture and renders the suggestion", async () => {
    previewCapture.mockResolvedValue(mkPreview({ title: "Filed Title" }));
    renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    await waitFor(() =>
      expect(previewCapture).toHaveBeenCalledWith(
        { capture_path: "captures/cap_1.md" },
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByText("Filed Title")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /accept & file/ }),
    ).toBeInTheDocument();
  });

  it("renders an error state when the preview is empty", async () => {
    previewCapture.mockResolvedValue(null);
    renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });
    expect(
      await screen.findByText(/Empty capture — nothing to file/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
  });

  it("commits the preview on accept, removes the filed capture, and appends the note", async () => {
    const user = userEvent.setup();
    previewCapture.mockResolvedValue(mkPreview());
    const commitResult: CommitResult = {
      note: mkNoteRecord({ id: "thr_new", title: "Filed Title" }),
      linked: ["x"],
      suggested: [],
      validation: "passed",
      validation_mode: "deterministic",
      validation_reasons: [],
      capture_archived: true,
      review_required: false,
      flagged: false,
    };
    commitCapture.mockResolvedValue(commitResult);
    const spies = renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    await screen.findByText("Filed Title");
    await user.click(screen.getByRole("button", { name: /accept & file/ }));

    await waitFor(() =>
      expect(commitCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          capture_path: "captures/cap_1.md",
          note_type: "topic",
          title: "Filed Title",
        }),
      ),
    );
    // Processing first, then removed once the backend confirms archival.
    expect(spies.setCaptureStatus).toHaveBeenCalledWith("cap_1", "processing");
    await waitFor(() =>
      expect(spies.removeCapture).toHaveBeenCalledWith("cap_1"),
    );
    expect(spies.appendNote).toHaveBeenCalled();
    expect(spies.openNote).toHaveBeenCalledWith("thr_new");
  });

  it("treats a 404 on commit as already-processed", async () => {
    const user = userEvent.setup();
    previewCapture.mockResolvedValue(mkPreview());
    commitCapture.mockRejectedValue(new ApiError("gone", 404));
    const spies = renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    await screen.findByText("Filed Title");
    await user.click(screen.getByRole("button", { name: /accept & file/ }));

    await waitFor(() =>
      expect(spies.removeCapture).toHaveBeenCalledWith("cap_1"),
    );
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Capture already processed." }),
    );
  });

  it("rolls the capture back to pending on a non-404 commit failure", async () => {
    const user = userEvent.setup();
    previewCapture.mockResolvedValue(mkPreview());
    commitCapture.mockRejectedValue(new ApiError("boom", 500));
    const spies = renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    await screen.findByText("Filed Title");
    await user.click(screen.getByRole("button", { name: /accept & file/ }));

    await waitFor(() =>
      expect(spies.setCaptureStatus).toHaveBeenCalledWith("cap_1", "pending"),
    );
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Failed to file"),
      }),
    );
  });

  it("keeps a rejected commit in the Inbox as needs review", async () => {
    const user = userEvent.setup();
    previewCapture.mockResolvedValue(mkPreview());
    commitCapture.mockResolvedValue({
      note: mkNoteRecord(),
      linked: [],
      suggested: [],
      validation: "failed",
      validation_mode: "deterministic",
      validation_reasons: ["Missing required source"],
      capture_archived: false,
      review_required: true,
      flagged: false,
      outcome: "needs_review",
    } satisfies CommitResult);
    const spies = renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    await screen.findByText("Filed Title");
    await user.click(screen.getByRole("button", { name: /accept & file/ }));

    await waitFor(() =>
      expect(spies.setCaptureStatus).toHaveBeenCalledWith(
        "cap_1",
        "needs_review",
      ),
    );
    expect(spies.removeCapture).not.toHaveBeenCalled();
    expect(spies.openNote).not.toHaveBeenCalled();
  });
});

describe("InboxView — bulk actions", () => {
  it("durably skips all selected captures and removes them", async () => {
    const user = userEvent.setup();
    skipCapture.mockResolvedValue({
      processed: false,
      outcome: "skipped",
      capture_archived: true,
    });
    const spies = renderInbox([
      mkCapture({ id: "a", title: "Alpha" }),
      mkCapture({ id: "b", title: "Beta" }),
    ]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(skipCapture).toHaveBeenCalledTimes(2));
    expect(skipCapture).toHaveBeenCalledWith(
      "captures/a.md",
      "Skipped by user from Inbox",
    );
    expect(skipCapture).toHaveBeenCalledWith(
      "captures/b.md",
      "Skipped by user from Inbox",
    );
    expect(spies.removeCapture).toHaveBeenCalledWith("a");
    expect(spies.removeCapture).toHaveBeenCalledWith("b");
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Skipped 2 captures" }),
    );
  });

  it("restores needs-review state when a bulk skip fails", async () => {
    const user = userEvent.setup();
    skipCapture.mockRejectedValue(new Error("archive unavailable"));
    const spies = renderInbox([
      mkCapture({
        id: "review",
        title: "Review me",
        status: "needs_review",
        reviewRequired: true,
      }),
    ]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() =>
      expect(spies.setCaptureStatus).toHaveBeenCalledWith(
        "review",
        "needs_review",
      ),
    );
    expect(spies.removeCapture).not.toHaveBeenCalled();
  });

  it("restores failed state when a bulk skip fails", async () => {
    const user = userEvent.setup();
    skipCapture.mockRejectedValue(new Error("archive unavailable"));
    const spies = renderInbox([
      mkCapture({
        id: "failed",
        title: "Retry me",
        status: "failed",
        outcome: "failed",
      }),
    ]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() =>
      expect(spies.setCaptureStatus).toHaveBeenCalledWith("failed", "failed"),
    );
    expect(spies.removeCapture).not.toHaveBeenCalled();
  });

  it("queues selected captures through the durable jobs API", async () => {
    const user = userEvent.setup();
    const queuedJob = mkJob({
      capture_id: "a",
      capture_path: "captures/a.md",
    });
    enqueueCaptureJobs.mockResolvedValue([queuedJob]);
    listCaptureJobs.mockResolvedValueOnce([]).mockResolvedValue([queuedJob]);
    const spies = renderInbox([mkCapture({ id: "a", title: "Alpha" })]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Queue" }));

    await waitFor(() =>
      expect(enqueueCaptureJobs).toHaveBeenCalledWith(["captures/a.md"]),
    );
    expect(spies.setCaptureStatus).not.toHaveBeenCalledWith("a", "processing");
    expect(spies.removeCapture).not.toHaveBeenCalled();
    expect((await screen.findAllByText("queued")).length).toBeGreaterThan(0);
  });

  it("retries a terminal job instead of creating a duplicate", async () => {
    const user = userEvent.setup();
    const failedJob = mkJob({
      id: "job_failed",
      capture_id: "a",
      capture_path: "captures/a.md",
      status: "failed",
      error: "Invalid frontmatter",
      attempts: 3,
    });
    listCaptureJobs.mockResolvedValue([failedJob]);
    retryCaptureJob.mockResolvedValue({
      ...failedJob,
      status: "queued",
      error: null,
    });
    renderInbox([mkCapture({ id: "a", title: "Alpha" })]);

    expect(await screen.findByText("failed")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Queue" }));

    await waitFor(() =>
      expect(retryCaptureJob).toHaveBeenCalledWith("job_failed"),
    );
    expect(enqueueCaptureJob).not.toHaveBeenCalled();
  });

  it("keeps a capture visible when enqueueing fails", async () => {
    const user = userEvent.setup();
    enqueueCaptureJobs.mockRejectedValue(new Error("queue unavailable"));
    const spies = renderInbox([mkCapture({ id: "a", title: "Alpha" })]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Queue" }));

    await waitFor(() => expect(enqueueCaptureJobs).toHaveBeenCalled());
    expect(spies.removeCapture).not.toHaveBeenCalled();
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("failed"),
      }),
    );
  });

  it("disables bulk actions when nothing is selected", () => {
    renderInbox([mkCapture({ id: "a", title: "Alpha" })]);
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
  });

  it("toggling a single row checkbox enables the bulk actions", async () => {
    const user = userEvent.setup();
    renderInbox([mkCapture({ id: "a", title: "Alpha" })]);
    await user.click(screen.getByLabelText("Select Alpha"));
    expect(screen.getByRole("button", { name: "Queue" })).toBeEnabled();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

describe("InboxView — selection", () => {
  it("does not fall back to the first capture when the selected id is gone", () => {
    renderInbox([mkCapture()], { selectedCaptureId: "ghost" });

    // No forced selection → no detail pane and no unprompted preview fetch.
    expect(document.querySelector(".inbox-detail")).toBeNull();
    expect(previewCapture).not.toHaveBeenCalled();
  });

  it("clicking a capture row selects it", async () => {
    const user = userEvent.setup();
    const spies = renderInbox([
      mkCapture({ id: "a", title: "Alpha" }),
      mkCapture({ id: "b", title: "Beta" }),
    ]);
    // The row is a button labelled by its content; scope to the list.
    const beta = screen.getByText("Beta");
    await user.click(beta);
    expect(spies.selectCapture).toHaveBeenCalledWith("b");
  });

  it("renders the filed state for a done capture", () => {
    renderInbox([mkCapture({ status: "done" })], {
      selectedCaptureId: "cap_1",
    });
    const detail = screen.getByText("✓ filed");
    expect(detail).toBeInTheDocument();
    // No preview fetch for an already-done capture.
    expect(previewCapture).not.toHaveBeenCalled();
  });

  it("renders a safe retry path for captures that need review", async () => {
    const user = userEvent.setup();
    enqueueCaptureJob.mockResolvedValue(mkJob());
    const spies = renderInbox(
      [
        mkCapture({
          status: "needs_review",
          reviewRequired: true,
          validationReasons: ["Sentinel was unavailable"],
          draftNoteId: "draft-1",
        }),
      ],
      { selectedCaptureId: "cap_1" },
    );

    expect(screen.getAllByText(/needs review/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Sentinel was unavailable")).toBeInTheDocument();
    expect(previewCapture).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "open draft note" }));
    expect(spies.openNote).toHaveBeenCalledWith("draft-1");

    await user.click(screen.getByRole("button", { name: "retry processing" }));
    await waitFor(() =>
      expect(enqueueCaptureJob).toHaveBeenCalledWith("captures/cap_1.md", true),
    );
    expect(commitCapture).not.toHaveBeenCalled();
    expect(spies.removeCapture).not.toHaveBeenCalled();
  });

  it("renders a durable failure reason with retry and skip actions", async () => {
    const user = userEvent.setup();
    enqueueCaptureJob.mockResolvedValue(mkJob());
    renderInbox(
      [
        mkCapture({
          status: "failed",
          outcome: "failed",
          lastError: "Provider timed out",
        }),
      ],
      { selectedCaptureId: "cap_1" },
    );

    expect(screen.getByText("Processing failed")).toBeInTheDocument();
    expect(screen.getByText("Provider timed out")).toBeInTheDocument();
    expect(previewCapture).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "retry processing" }));
    await waitFor(() =>
      expect(enqueueCaptureJob).toHaveBeenCalledWith("captures/cap_1.md", true),
    );
  });

  it("prunes a checked item when a single-capture action removes it", async () => {
    const user = userEvent.setup();
    const capture = mkCapture({
      filePath: undefined,
      suggestion: {
        type: "topic",
        destFolder: "topics",
        tags: [],
        links: [],
        title: "Filed title",
      },
    });
    const spies = renderInbox([capture], { selectedCaptureId: capture.id });

    await user.click(screen.getByLabelText("Select Meeting notes"));
    expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "skip" }));

    expect(spies.removeCapture).toHaveBeenCalledWith("cap_1");
    expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
  });
});

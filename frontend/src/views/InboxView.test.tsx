import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { InboxView } from "./InboxView";
import type { Capture } from "../data/types";
import type { CapturePreview, CommitResult, ProcessResult } from "../api/captures";
import { ApiError } from "../api/client";

// --- Mock the captures API: InboxView drives all backend I/O through it. ---
const { previewCapture, commitCapture, processCapture } = vi.hoisted(() => ({
  previewCapture: vi.fn(),
  commitCapture: vi.fn(),
  processCapture: vi.fn(),
}));

vi.mock("../api/captures", async (importOriginal) => {
  // Keep the real pure helpers (captureRelPath); stub only the network calls.
  const actual = await importOriginal<typeof import("../api/captures")>();
  return { ...actual, previewCapture, commitCapture, processCapture };
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

/** Spies the test inspects after interactions. */
interface Spies {
  selectCapture: ReturnType<typeof vi.fn>;
  setCaptureStatus: ReturnType<typeof vi.fn>;
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
  previewCapture.mockReset();
  commitCapture.mockReset();
  processCapture.mockReset();
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

describe("InboxView — preview & accept", () => {
  it("fetches a preview for the selected capture and renders the suggestion", async () => {
    previewCapture.mockResolvedValue(mkPreview({ title: "Filed Title" }));
    renderInbox([mkCapture()], { selectedCaptureId: "cap_1" });

    expect(previewCapture).toHaveBeenCalledWith(
      { capture_path: "captures/cap_1.md" },
      expect.any(AbortSignal),
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

  it("commits the preview on accept, marking the capture done and appending the note", async () => {
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
    // processing first, then done once the commit resolves.
    expect(spies.setCaptureStatus).toHaveBeenCalledWith("cap_1", "processing");
    await waitFor(() =>
      expect(spies.setCaptureStatus).toHaveBeenCalledWith("cap_1", "done"),
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
      expect(spies.setCaptureStatus).toHaveBeenCalledWith("cap_1", "done"),
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
      expect.objectContaining({ body: expect.stringContaining("Failed to file") }),
    );
  });
});

describe("InboxView — bulk actions", () => {
  it("skips all selected captures and marks them done", async () => {
    const user = userEvent.setup();
    const spies = renderInbox([
      mkCapture({ id: "a", title: "Alpha" }),
      mkCapture({ id: "b", title: "Beta" }),
    ]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(spies.setCaptureStatus).toHaveBeenCalledWith("a", "done");
    expect(spies.setCaptureStatus).toHaveBeenCalledWith("b", "done");
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Skipped 2 captures" }),
    );
  });

  it("processes selected captures through the backend", async () => {
    const user = userEvent.setup();
    const result: ProcessResult = {
      processed: true,
      note_title: "Filed",
      note_type: "topic",
      linked: [],
      suggested: [],
    };
    processCapture.mockResolvedValue(result);
    const spies = renderInbox([mkCapture({ id: "a", title: "Alpha" })]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Process" }));

    expect(spies.setCaptureStatus).toHaveBeenCalledWith("a", "processing");
    await waitFor(() => expect(processCapture).toHaveBeenCalledWith("captures/a.md"));
    await waitFor(() =>
      expect(spies.setCaptureStatus).toHaveBeenCalledWith("a", "done"),
    );
  });

  it("rolls a capture back to pending when the backend reports it unprocessed", async () => {
    const user = userEvent.setup();
    processCapture.mockResolvedValue({ processed: false, error: "no content" });
    const spies = renderInbox([mkCapture({ id: "a", title: "Alpha" })]);

    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Process" }));

    await waitFor(() =>
      expect(spies.setCaptureStatus).toHaveBeenCalledWith("a", "pending"),
    );
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("no content") }),
    );
  });

  it("disables bulk actions when nothing is selected", () => {
    renderInbox([mkCapture({ id: "a", title: "Alpha" })]);
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Process" })).toBeDisabled();
  });

  it("toggling a single row checkbox enables the bulk actions", async () => {
    const user = userEvent.setup();
    renderInbox([mkCapture({ id: "a", title: "Alpha" })]);
    await user.click(screen.getByLabelText("Select Alpha"));
    expect(screen.getByRole("button", { name: "Process" })).toBeEnabled();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

describe("InboxView — selection", () => {
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
    renderInbox([mkCapture({ status: "done" })], { selectedCaptureId: "cap_1" });
    const detail = screen.getByText("✓ filed");
    expect(detail).toBeInTheDocument();
    // No preview fetch for an already-done capture.
    expect(previewCapture).not.toHaveBeenCalled();
  });
});

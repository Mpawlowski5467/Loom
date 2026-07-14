import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaptureJob } from "../../api/captures";
import type { Capture } from "../../data/types";
import { JobHistory } from "./JobHistory";

function job(overrides: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: "job-1",
    capture_id: "capture-1",
    capture_path: "/vault/threads/captures/archived-capture.md",
    source: "manual",
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    outcome: null,
    created_at: "2026-07-10T12:00:00+00:00",
    updated_at: "2026-07-10T12:05:00+00:00",
    ...overrides,
  };
}

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "capture-1",
    title: "Current capture",
    folder: "captures",
    body: "body",
    receivedAt: "2026-07-10T12:00:00+00:00",
    status: "pending",
    filePath: "/vault/threads/captures/current.md",
    ...overrides,
  };
}

function renderHistory(
  jobs: CaptureJob[],
  captures: Capture[] = [],
  overrides: Partial<Parameters<typeof JobHistory>[0]> = {},
) {
  const props = {
    jobs,
    captures,
    loaded: true,
    error: null,
    onOpenNote: vi.fn(),
    onCancel: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    onPruneHistory: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  render(<JobHistory {...props} />);
  return props;
}

describe("JobHistory", () => {
  it("keeps a completed job visible after its source capture is archived", async () => {
    const user = userEvent.setup();
    const props = renderHistory([
      job({
        status: "completed",
        attempts: 2,
        outcome: "filed",
        note_id: "note-1",
        note_title: "Filed note",
        target_path: "/vault/threads/topics/filed-note.md",
      }),
    ]);

    await user.click(screen.getByRole("tab", { name: /History 1/ }));

    expect(
      screen.getByRole("heading", { name: "archived-capture" }),
    ).toBeVisible();
    expect(screen.getByText("2 of 3")).toBeVisible();
    expect(screen.getByText("Filed note")).toBeVisible();
    expect(screen.getByText("topics/filed-note.md")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open note" }));
    expect(props.onOpenNote).toHaveBeenCalledWith("note-1");
  });

  it("segments attention states and supports arrow-key tab navigation", async () => {
    const user = userEvent.setup();
    renderHistory([
      job({ id: "active", status: "running" }),
      job({ id: "review", status: "failed", error: "Provider failed" }),
      job({ id: "history", status: "cancelled" }),
    ]);

    const active = screen.getByRole("tab", { name: /Active 1/ });
    active.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: /Review 1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Provider failed")).toBeVisible();
    expect(screen.queryByText("running")).not.toBeInTheDocument();
  });

  it("filters the current segment by both status and source", async () => {
    const user = userEvent.setup();
    renderHistory([
      job({ id: "queued-mail", status: "queued", source: "bridge:gmail" }),
      job({
        id: "retry-manual",
        capture_id: "capture-2",
        capture_path: "captures/retry-manual.md",
        status: "retrying",
        source: "manual",
      }),
      job({
        id: "queued-manual",
        capture_id: "capture-3",
        capture_path: "captures/queued-manual.md",
        status: "queued",
        source: "manual",
      }),
    ]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter jobs by status" }),
      "queued",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter jobs by source" }),
      "bridge:gmail",
    );

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("archived-capture")).toBeVisible();
    expect(within(panel).queryByText("retry-manual")).not.toBeInTheDocument();
    expect(within(panel).queryByText("queued-manual")).not.toBeInTheDocument();
  });

  it("offers cancel and retry only while the source operation is valid", async () => {
    const user = userEvent.setup();
    const queued = job({ id: "queued", status: "queued" });
    const failed = job({ id: "failed", status: "failed" });
    const archivedFailure = job({
      id: "archived-failed",
      capture_id: "missing",
      capture_path: "captures/missing.md",
      status: "failed",
    });
    const props = renderHistory([queued, failed, archivedFailure], [capture()]);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledWith(queued));

    await user.click(screen.getByRole("tab", { name: /Review 2/ }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(props.onRetry).toHaveBeenCalledWith(failed));
    expect(screen.getByText("Source capture archived")).toBeVisible();
  });

  it("confirms and applies the selected history-retention window", async () => {
    const user = userEvent.setup();
    const onPruneHistory = vi.fn().mockResolvedValue(2);
    renderHistory([job({ status: "completed" })], [], { onPruneHistory });
    await user.click(screen.getByRole("tab", { name: /History 1/ }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: "History retention window" }),
      "7",
    );
    await user.click(screen.getByRole("button", { name: "Remove older" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("older than 7 days");
    await user.click(screen.getByRole("button", { name: "Remove history" }));

    await waitFor(() => expect(onPruneHistory).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Removed 2 jobs.")).toBeVisible();
  });
});

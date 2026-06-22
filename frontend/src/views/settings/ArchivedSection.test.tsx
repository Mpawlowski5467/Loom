import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArchivedSection } from "./ArchivedSection";
import type { ArchivedNoteRecord } from "../../api/archive";

const { listArchivedNotes, restoreArchivedNote } = vi.hoisted(() => ({
  listArchivedNotes: vi.fn(),
  restoreArchivedNote: vi.fn(),
}));

vi.mock("../../api/archive", () => ({
  listArchivedNotes,
  restoreArchivedNote,
}));

function record(overrides: Partial<ArchivedNoteRecord> = {}): ArchivedNoteRecord {
  return {
    id: "thr_aaa111",
    title: "Python",
    type: "topic",
    original_path: "topics/python.md",
    archived_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  listArchivedNotes.mockReset();
  restoreArchivedNote.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ArchivedSection", () => {
  it("lists archived notes with their original path and date", async () => {
    listArchivedNotes.mockResolvedValue({ notes: [record()] });
    render(<ArchivedSection />);

    expect(await screen.findByText("Python")).toBeInTheDocument();
    expect(
      screen.getByText(/topics\/python\.md · topic · archived 2026-06-01/),
    ).toBeInTheDocument();
  });

  it("shows an empty state when nothing is archived", async () => {
    listArchivedNotes.mockResolvedValue({ notes: [] });
    render(<ArchivedSection />);

    expect(await screen.findByText("No archived notes.")).toBeInTheDocument();
  });

  it("restores a note and refreshes the list", async () => {
    const user = userEvent.setup();
    // First load shows one note; after restore the list comes back empty.
    listArchivedNotes
      .mockResolvedValueOnce({ notes: [record()] })
      .mockResolvedValueOnce({ notes: [] });
    restoreArchivedNote.mockResolvedValue({ id: "thr_aaa111", status: "active" });

    render(<ArchivedSection />);
    await user.click(await screen.findByRole("button", { name: /Restore/ }));

    expect(restoreArchivedNote).toHaveBeenCalledWith("thr_aaa111");
    expect(
      await screen.findByText(/Restored "Python" to topics\/python\.md\./),
    ).toBeInTheDocument();
    expect(screen.getByText("No archived notes.")).toBeInTheDocument();
  });

  it("surfaces the backend error when a restore collides", async () => {
    const user = userEvent.setup();
    listArchivedNotes.mockResolvedValue({ notes: [record()] });
    restoreArchivedNote.mockRejectedValue(
      new Error("Cannot restore: a note already exists at topics/python.md."),
    );

    render(<ArchivedSection />);
    await user.click(await screen.findByRole("button", { name: /Restore/ }));

    await waitFor(() =>
      expect(
        screen.getByText(/Cannot restore: a note already exists/),
      ).toBeInTheDocument(),
    );
    // The note remains listed since the restore failed.
    expect(screen.getByText("Python")).toBeInTheDocument();
  });
});

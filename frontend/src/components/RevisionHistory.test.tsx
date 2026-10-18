import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { RevisionHistory } from "./RevisionHistory";
import { RunUndo } from "./RunUndo";

const api = vi.hoisted(() => ({
  listRevisions: vi.fn(),
  getRevision: vi.fn(),
  restoreRevision: vi.fn(),
  previewUndoRun: vi.fn(),
  undoRun: vi.fn(),
  updateNote: vi.fn(),
}));
vi.mock("../api/revisions", () => api);
vi.mock("../context/app-ctx", () => ({
  useApp: () => ({
    notes: [],
    updateNote: api.updateNote,
    config: { active_vault: "test" },
  }),
}));
const revision = {
  id: "rev1",
  run_id: "",
  caller: "user",
  created: "2026-09-05T00:00:00Z",
  before: { "topics/a.md": "Original" },
  after: { "topics/a.md": "Changed" },
  current_hash: "previewhash",
};
beforeEach(() => {
  vi.clearAllMocks();
  api.listRevisions.mockResolvedValue([revision]);
  api.getRevision.mockResolvedValue(revision);
});

it("keeps revision preview and shows a stale restore conflict without changing the note", async () => {
  const user = userEvent.setup();
  api.restoreRevision.mockRejectedValue(
    new Error("The note changed after the preview"),
  );
  render(<RevisionHistory noteId="a" />);
  await user.click(screen.getByRole("button", { name: "Version history" }));
  await user.click(await screen.findByRole("button", { name: /· user/ }));
  await user.click(
    await screen.findByRole("button", {
      name: "Restore version before this change",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Restore version" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("note changed");
  expect(api.restoreRevision).toHaveBeenCalledWith("rev1", "a", "previewhash");
  expect(api.updateNote).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText("Changes: minus removed, plus added"),
  ).toHaveTextContent("Original");
});

it("blocks whole-run undo when even one file conflicts", async () => {
  const user = userEvent.setup();
  api.previewUndoRun.mockResolvedValue({
    conflicts: ["topics/a.md"],
    files: [
      {
        path: "topics/a.md",
        before: "old",
        after: "agent",
        current_hash: "new",
        conflict: true,
      },
      {
        path: "topics/b.md",
        before: null,
        after: "created",
        current_hash: "hash",
        conflict: false,
      },
    ],
  });
  render(<RunUndo runId="run1" />);
  await user.click(screen.getByRole("button", { name: /Preview undo/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("topics/a.md");
  expect(screen.getByRole("button", { name: /Undo all vault/ })).toBeDisabled();
  expect(api.undoRun).not.toHaveBeenCalled();
});

it("requires a reviewed run preview and sends every preview hash on confirmation", async () => {
  const user = userEvent.setup();
  api.previewUndoRun.mockResolvedValue({
    conflicts: [],
    files: [
      {
        path: "topics/a.md",
        before: "old",
        after: "agent",
        current_hash: "a-hash",
        conflict: false,
      },
      {
        path: "captures/source.md",
        before: "source",
        after: null,
        current_hash: "missing",
        conflict: false,
      },
    ],
  });
  api.undoRun.mockResolvedValue({ status: "undone" });
  render(<RunUndo runId="run1" />);
  await user.click(screen.getByRole("button", { name: /Preview undo/ }));
  await user.click(
    await screen.findByRole("button", { name: /Undo all vault/ }),
  );
  expect(api.undoRun).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Undo run" }));
  await waitFor(() =>
    expect(api.undoRun).toHaveBeenCalledWith("run1", {
      "topics/a.md": "a-hash",
      "captures/source.md": "missing",
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Run undone" }),
  ).toBeDisabled();
});

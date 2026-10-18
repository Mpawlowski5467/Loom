import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { NoteHistory } from "./NoteHistory";

const api = vi.hoisted(() => ({
  getHistoryStatus: vi.fn(),
  listHistory: vi.fn(),
  getCommitDiff: vi.fn(),
  revertCommit: vi.fn(),
  reloadNoteBody: vi.fn(),
}));
vi.mock("../api/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/history")>()),
  getHistoryStatus: api.getHistoryStatus,
  listHistory: api.listHistory,
  getCommitDiff: api.getCommitDiff,
  revertCommit: api.revertCommit,
}));
vi.mock("../context/app-ctx", () => ({
  useApp: () => ({
    config: { active_vault: "test" },
    reloadNoteBody: api.reloadNoteBody,
  }),
}));

const entry = {
  sha: "a".repeat(40),
  short_sha: "aaaaaaaaaa",
  subject: "spider: linked threads/topics/raft.md",
  author: "spider",
  date: "2026-09-05T00:00:00Z",
  agents: ["spider"],
  action: "linked",
  reason: "Resolved title match",
  sentinel: "passed (weaver created)",
  run_id: "",
  group: "grp_1",
  reverts: "",
  files: ["threads/topics/raft.md"],
  revertible: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getHistoryStatus.mockResolvedValue({ enabled: true, reason: "" });
  api.listHistory.mockResolvedValue([entry]);
  api.getCommitDiff.mockResolvedValue({
    ...entry,
    file_diffs: [
      {
        path: "threads/topics/raft.md",
        status: "modified",
        before: "Raft",
        after: "Raft [[Paxos]]",
        truncated: false,
      },
    ],
    files_truncated: false,
    patch: "",
    patch_truncated: false,
  });
});

async function openFirstCommit() {
  const user = userEvent.setup();
  render(<NoteHistory noteId="n1" folder="topics" filename="raft.md" />);
  await user.click(screen.getByRole("button", { name: "Change history" }));
  await user.click(await screen.findByRole("button", { name: /linked/ }));
  return user;
}

it("lists this note's commits and shows a selected commit's diff", async () => {
  await openFirstCommit();
  expect(api.listHistory).toHaveBeenCalledWith({
    path: "threads/topics/raft.md",
    limit: 50,
  });
  expect(await screen.findByText("Resolved title match")).toBeVisible();
  expect(
    screen.getByLabelText("Changes: minus removed, plus added"),
  ).toHaveTextContent("[[Paxos]]");
  expect(screen.getByText(/Sentinel passed/)).toBeVisible();
});

it("undoes a commit, then reloads history and the note body", async () => {
  api.revertCommit.mockResolvedValue({
    status: "reverted",
    reverted: entry.sha,
    sha: "b".repeat(40),
    files: entry.files,
    sentinel: { status: "passed", reasons: [] },
  });
  const user = await openFirstCommit();
  await user.click(
    await screen.findByRole("button", { name: "Undo this change" }),
  );
  await user.click(screen.getByRole("button", { name: "Undo change" }));
  expect(await screen.findByText(/Undone in commit/)).toHaveTextContent(
    "bbbbbbbbbb",
  );
  expect(api.revertCommit).toHaveBeenCalledWith(entry.sha);
  await waitFor(() => expect(api.reloadNoteBody).toHaveBeenCalledWith("n1"));
  expect(api.listHistory).toHaveBeenCalledTimes(2);
});

it("keeps the note untouched when a newer edit blocks the undo", async () => {
  api.revertCommit.mockRejectedValue(
    new Error("Later changes overlap this commit."),
  );
  const user = await openFirstCommit();
  await user.click(
    await screen.findByRole("button", { name: "Undo this change" }),
  );
  await user.click(screen.getByRole("button", { name: "Undo change" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("overlap");
  expect(api.reloadNoteBody).not.toHaveBeenCalled();
});

it("explains why history is unavailable", async () => {
  api.getHistoryStatus.mockResolvedValue({
    enabled: false,
    reason: "Vault history needs git, which is not installed.",
  });
  const user = userEvent.setup();
  render(<NoteHistory noteId="n1" folder="topics" filename="raft.md" />);
  await user.click(screen.getByRole("button", { name: "Change history" }));
  expect(await screen.findByRole("status")).toHaveTextContent("needs git");
  expect(api.listHistory).not.toHaveBeenCalled();
});

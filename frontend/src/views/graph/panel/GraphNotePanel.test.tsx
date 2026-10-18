import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNoteFindings } from "@/api/findings";
import { listHistory, revertCommit, type HistoryEntry } from "@/api/history";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import { supersessionSeed } from "@/data/notesSupersession";
import type { Note } from "@/data/types";
import { buildWikilinkMap, linkTarget } from "@/data/wikilinks";
import { TestAppearanceProvider } from "@/test/appearance";
import { GraphNotePanel } from "./GraphNotePanel";

vi.mock("@/api/history", async (orig) => ({
  ...(await orig<typeof import("@/api/history")>()),
  listHistory: vi.fn(),
  revertCommit: vi.fn(),
}));
vi.mock("@/api/findings", () => ({ getNoteFindings: vi.fn() }));

const notes = supersessionSeed;
const [v1, v2] = notes as [Note, Note];

function commit(sha: string, patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sha: `${sha}${"0".repeat(40 - sha.length)}`,
    short_sha: sha,
    subject: `weaver: updated ${sha}`,
    author: "weaver",
    date: "2026-05-20T10:00:00Z",
    agents: ["weaver"],
    action: "updated the note",
    reason: "",
    sentinel: "passed",
    run_id: "",
    group: "",
    reverts: "",
    files: [],
    revertible: true,
    ...patch,
  };
}

function renderPanel(note: Note) {
  const map = buildWikilinkMap(notes);
  const ctx = {
    notes,
    config: { active_vault: "v" },
    noteById: (id: string) => notes.find((n) => n.id === id),
    resolveWikilink: (raw: string) => map.get(linkTarget(raw)),
    wikilinkMap: map,
    updateNote: vi.fn(),
    pushToast: vi.fn(),
    openNote: vi.fn(),
    reloadNoteBody: vi.fn(async () => {}),
  } as unknown as AppContextValue;
  const onClose = vi.fn();
  const onSelectNote = vi.fn();
  render(
    <MemoryRouter>
      <TestAppearanceProvider>
        <AppCtx.Provider value={ctx}>
          <GraphNotePanel
            note={note}
            onClose={onClose}
            onSelectNote={onSelectNote}
          />
        </AppCtx.Provider>
      </TestAppearanceProvider>
    </MemoryRouter>,
  );
  return { ctx, onClose, onSelectNote };
}

describe("GraphNotePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(listHistory).mockResolvedValue([
      commit("abc1234"),
      commit("def5678"),
    ]);
    vi.mocked(getNoteFindings).mockResolvedValue([]);
  });

  it("shows the path, last commit and body, and opens the full editor", async () => {
    const user = userEvent.setup();
    const { ctx, onClose } = renderPanel(v2);
    const panel = screen.getByRole("complementary", { name: "Open note" });
    expect(panel).toHaveTextContent(`${v2.folder}/${v2.filename}`);
    expect(await within(panel).findAllByText(/abc1234 ·/)).not.toHaveLength(0);
    expect(
      await screen.findByRole("textbox", { name: "Note body" }),
    ).toHaveTextContent("Second plan for the read cache");

    await user.click(screen.getByRole("button", { name: "Open full editor" }));
    expect(ctx.openNote).toHaveBeenCalledWith(v2.id);
    await user.click(screen.getByRole("button", { name: "Close note" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("has no Archivist card when there's nothing to warn about", async () => {
    renderPanel(v2);
    await screen.findByText("History");
    await waitFor(() => expect(getNoteFindings).toHaveBeenCalled());
    expect(screen.queryByText("Archivist")).not.toBeInTheDocument();
  });

  it("warns that a note is superseded and links its replacement", async () => {
    const user = userEvent.setup();
    const { onSelectNote } = renderPanel(v1);
    const card = screen.getByRole("alert");
    expect(card).toHaveTextContent(/Archivist.*superseded by Cache plan v2/);
    await user.click(
      within(card).getByRole("button", { name: "Cache plan v2" }),
    );
    expect(onSelectNote).toHaveBeenCalledWith(v2.id);
  });

  it("lists Archivist findings", async () => {
    vi.mocked(getNoteFindings).mockResolvedValue([
      {
        agent: "archivist",
        kind: "stale",
        message: "Not updated in 200 days.",
        created: "2026-05-01T00:00:00Z",
      },
    ]);
    renderPanel(v2);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /stale.*Not updated in 200 days/i,
    );
  });

  it("undoes a commit after confirmation", async () => {
    vi.mocked(revertCommit).mockResolvedValue({
      status: "reverted",
      reverted: "abc1234",
      sha: "9999999aaaa",
      files: [],
      sentinel: { status: "passed", reasons: [] },
    });
    const user = userEvent.setup();
    const { ctx } = renderPanel(v2);
    await user.click(
      await screen.findByRole("button", { name: "Undo abc1234" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Undo change",
      }),
    );
    await waitFor(() =>
      expect(revertCommit).toHaveBeenCalledWith(commit("abc1234").sha),
    );
    expect(ctx.reloadNoteBody).toHaveBeenCalledWith(v2.id);
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(/Undone in 9999999/),
      }),
    );
  });

  it("explains when history is unavailable", async () => {
    vi.mocked(listHistory).mockRejectedValue(
      new Error("Vault history is off."),
    );
    renderPanel(v2);
    expect(
      await screen.findByText("Vault history is off."),
    ).toBeInTheDocument();
  });
});

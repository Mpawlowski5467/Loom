import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveTreePath,
  createFolder,
  moveTreePath,
  renameTreePath,
} from "@/api/notes";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import { supersessionSeed } from "@/data/notesSupersession";
import type { Note } from "@/data/types";
import { VaultTree } from "./VaultTree";

vi.mock("@/api/notes", async (orig) => ({
  ...(await orig<typeof import("@/api/notes")>()),
  createFolder: vi.fn(async () => ({})),
  moveTreePath: vi.fn(async () => ({})),
  renameTreePath: vi.fn(async () => ({})),
  archiveTreePath: vi.fn(async () => ({})),
}));

const notes: Note[] = [
  ...supersessionSeed,
  {
    ...supersessionSeed[2]!,
    id: "thr_x1",
    title: "Loose idea",
    folder: "scratch",
    filename: "loose-idea.md",
  },
];

function renderTree() {
  const ctx = {
    notes,
    currentNoteId: null,
    addFolder: vi.fn(),
    pushToast: vi.fn(),
    updateNote: vi.fn(),
    removeNote: vi.fn(),
    setTab: vi.fn(),
    setNewNoteOpen: vi.fn(),
  } as unknown as AppContextValue;
  render(
    <MemoryRouter>
      <AppCtx.Provider value={ctx}>
        <VaultTree
          notes={notes}
          extraFolders={["scratch"]}
          currentNoteId={null}
          draftIds={new Set()}
        />
      </AppCtx.Provider>
    </MemoryRouter>,
  );
  return ctx;
}

describe("VaultTree folder management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("starts a new note", async () => {
    const user = userEvent.setup();
    const ctx = renderTree();
    await user.click(screen.getByRole("button", { name: "New note" }));
    expect(ctx.setNewNoteOpen).toHaveBeenCalledWith(true);
  });

  it("creates a folder and rejects an invalid name", async () => {
    const user = userEvent.setup();
    const ctx = renderTree();
    await user.click(screen.getByRole("button", { name: "New folder" }));
    const input = await screen.findByRole("textbox", {
      name: "New folder name",
    });
    await user.type(input, "bad name{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/Letters, digits/);
    await user.clear(input);
    await user.type(input, "research/2026{Enter}");
    await waitFor(() =>
      expect(createFolder).toHaveBeenCalledWith("research/2026"),
    );
    expect(ctx.addFolder).toHaveBeenCalledWith("research/2026");
  });

  it("renames a note's file from its menu", async () => {
    const user = userEvent.setup();
    const ctx = renderTree();
    await user.click(
      screen.getByRole("button", { name: "Actions for Latency budget" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Rename file" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Rename file Latency budget",
    });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "latency-targets{Enter}");
    await waitFor(() =>
      expect(renameTreePath).toHaveBeenCalledWith(
        "topics/latency-budget.md",
        "latency-targets",
      ),
    );
    expect(ctx.updateNote).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "latency-targets.md" }),
    );
  });

  it("archives a custom folder after confirmation", async () => {
    const user = userEvent.setup();
    const ctx = renderTree();
    fireEvent.contextMenu(screen.getByRole("button", { name: /^scratch/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Archive "scratch"\?/);
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(archiveTreePath).toHaveBeenCalledWith("scratch"),
    );
    expect(ctx.removeNote).toHaveBeenCalledWith("thr_x1");
  });

  it("offers no actions on the fixed core folders", () => {
    renderTree();
    expect(
      screen.queryByRole("button", { name: "Actions for projects" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for scratch" }),
    ).toBeInTheDocument();
  });

  it("moves a note by dragging it onto a folder", async () => {
    const ctx = renderTree();
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
      get types() {
        return [...data.keys()];
      },
      effectAllowed: "",
      dropEffect: "",
    };
    const note = screen.getByRole("link", { name: /Loose idea/ });
    const target = screen
      .getByRole("button", { name: /^topics/ })
      .closest("li")!;
    fireEvent.dragStart(note, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() =>
      expect(moveTreePath).toHaveBeenCalledWith(
        "scratch/loose-idea.md",
        "topics/loose-idea.md",
      ),
    );
    expect(ctx.updateNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "thr_x1", folder: "topics" }),
    );
  });
});

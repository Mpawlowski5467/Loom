import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewNoteModal } from "./NewNoteModal";
import type { NoteRecord, TreeNode } from "../api/notes";

// --- Mock the notes API: the modal drives all backend I/O through it. ---
const { createNote, getTree } = vi.hoisted(() => ({
  createNote: vi.fn(),
  getTree: vi.fn(),
}));

vi.mock("../api/notes", async (importOriginal) => {
  // Keep the real pure helpers; stub only the network calls.
  const actual = await importOriginal<typeof import("../api/notes")>();
  return { ...actual, createNote, getTree };
});

/** A tree whose non-dot directory children populate the folder dropdown. */
function mkTree(): TreeNode {
  const dir = (name: string): TreeNode => ({
    name,
    path: name,
    is_dir: true,
    children: [],
  });
  return {
    name: "threads",
    path: "",
    is_dir: true,
    children: [
      dir("projects"),
      dir("topics"),
      // Dot-dirs and files are filtered out of the dropdown.
      { name: ".archive", path: ".archive", is_dir: true, children: [] },
      { name: "readme.md", path: "readme.md", is_dir: false, children: [] },
    ],
  };
}

function mkNote(over: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: "thr_abc123",
    title: "Created Note",
    type: "topic",
    tags: [],
    created: "2026-06-21T10:00:00Z",
    modified: "2026-06-21T10:00:00Z",
    author: "agent:weaver",
    source: "manual",
    links: [],
    status: "active",
    history: [],
    file_path: "/v/threads/topics/created-note.md",
    body: "",
    wikilinks: [],
    ...over,
  };
}

function renderModal(initialTitle?: string) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <NewNoteModal
      onClose={onClose}
      onCreated={onCreated}
      initialTitle={initialTitle}
    />,
  );
  return { onClose, onCreated };
}

beforeEach(() => {
  createNote.mockReset();
  getTree.mockReset();
  getTree.mockResolvedValue(mkTree());
});

describe("NewNoteModal", () => {
  it("disables Create note for an empty/whitespace title and enables it once a title is typed", async () => {
    const user = userEvent.setup();
    renderModal();

    const createBtn = screen.getByRole("button", { name: "Create note" });
    expect(createBtn).toBeDisabled();

    const titleInput = screen.getByLabelText("Title");
    // Whitespace alone stays disabled.
    await user.type(titleInput, "   ");
    expect(createBtn).toBeDisabled();

    await user.type(titleInput, "Real title");
    expect(createBtn).toBeEnabled();
  });

  it("populates the folder dropdown from getTree (non-dot dirs only)", async () => {
    renderModal();

    // The mocked tree's directory children surface as options after mount.
    expect(
      await screen.findByRole("option", { name: "projects" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "topics" })).toBeInTheDocument();
    // Dot-dirs and files are excluded.
    expect(
      screen.queryByRole("option", { name: ".archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "readme.md" }),
    ).not.toBeInTheDocument();
  });

  it("creates the note once with a trimmed title, parsed tags, and empty folder for the auto option, then calls onCreated and onClose", async () => {
    const user = userEvent.setup();
    const note = mkNote();
    createNote.mockResolvedValue(note);
    const { onClose, onCreated } = renderModal();

    // Wait for the folder dropdown to load so the auto option is stable.
    await screen.findByRole("option", { name: "projects" });

    await user.type(screen.getByLabelText("Title"), "  Spaced Title  ");
    // Tags: comma-split, leading-# stripped, blanks removed.
    await user.type(screen.getByLabelText("Tags"), "#infra, perf, , #ml");

    await user.click(screen.getByRole("button", { name: "Create note" }));

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith({
      title: "Spaced Title",
      type: "topic",
      tags: ["infra", "perf", "ml"],
      folder: "",
    });
    expect(onCreated).toHaveBeenCalledWith(note);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits on Cmd/Ctrl+Enter from an input", async () => {
    const user = userEvent.setup();
    const note = mkNote();
    createNote.mockResolvedValue(note);
    const { onClose, onCreated } = renderModal();

    await screen.findByRole("option", { name: "projects" });

    const titleInput = screen.getByLabelText("Title");
    await user.type(titleInput, "Keyboard Note");
    await user.type(titleInput, "{Control>}{Enter}{/Control}");

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Keyboard Note" }),
    );
    expect(onCreated).toHaveBeenCalledWith(note);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an error and keeps the modal open when createNote rejects", async () => {
    const user = userEvent.setup();
    createNote.mockRejectedValue(new Error("Create failed: boom"));
    const { onClose, onCreated } = renderModal();

    await screen.findByRole("option", { name: "projects" });

    await user.type(screen.getByLabelText("Title"), "Doomed Note");
    await user.click(screen.getByRole("button", { name: "Create note" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Create failed: boom");
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

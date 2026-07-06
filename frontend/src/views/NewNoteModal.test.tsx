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

/** A tree with a NESTED folder so full paths surface in the dropdown. */
function mkTree(): TreeNode {
  const dir = (name: string, path: string, children: TreeNode[] = []): TreeNode => ({
    name,
    path,
    is_dir: true,
    children,
  });
  return dir("threads", "", [
    dir("projects", "projects", [dir("clients", "projects/clients")]),
    dir("topics", "topics"),
    // Dot-dirs and files are filtered out of the dropdown.
    dir(".archive", ".archive"),
    { name: "readme.md", path: "readme.md", is_dir: false, children: [] },
  ]);
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

/** Wait for the mocked getTree response to land in the folder dropdown. */
async function foldersLoaded() {
  await screen.findByRole("option", { name: "projects" });
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

  it("renders a type chip per option with Topic checked by default, and selecting one updates the folder placeholder", async () => {
    const user = userEvent.setup();
    renderModal();

    const group = screen.getByRole("radiogroup", { name: "Type" });
    expect(group).toBeInTheDocument();
    const chips = screen.getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual([
      "Topic",
      "Project",
      "Person",
      "Daily",
      "Capture",
    ]);
    expect(screen.getByRole("radio", { name: "Topic" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("option", { name: "— default (topics) —" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Project" }));

    expect(screen.getByRole("radio", { name: "Project" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Topic" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.getByRole("option", { name: "— default (projects) —" }),
    ).toBeInTheDocument();
  });

  it("offers nested folder paths from getTree (dot-dirs and files excluded)", async () => {
    renderModal();
    await foldersLoaded();

    expect(
      screen.getByRole("option", { name: "projects/clients" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "topics" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: ".archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "readme.md" }),
    ).not.toBeInTheDocument();
  });

  it("commits tag chips on Enter and comma (stripping a leading #), removes via × and Backspace-on-empty", async () => {
    const user = userEvent.setup();
    renderModal();

    const tagsInput = screen.getByLabelText("Tags");
    await user.type(tagsInput, "#infra{Enter}");
    await user.type(tagsInput, "perf,");

    expect(screen.getByText("#infra")).toBeInTheDocument();
    expect(screen.getByText("#perf")).toBeInTheDocument();
    expect(tagsInput).toHaveValue("");

    // Backspace on an empty input pops the LAST chip.
    await user.type(tagsInput, "{Backspace}");
    expect(screen.queryByText("#perf")).not.toBeInTheDocument();
    expect(screen.getByText("#infra")).toBeInTheDocument();

    // × removes a specific chip.
    await user.click(
      screen.getByRole("button", { name: "Remove tag infra" }),
    );
    expect(screen.queryByText("#infra")).not.toBeInTheDocument();
  });

  it("creates once with a trimmed title, chip tags, and empty folder for auto, then calls onCreated and onClose", async () => {
    const user = userEvent.setup();
    const note = mkNote();
    createNote.mockResolvedValue(note);
    const { onClose, onCreated } = renderModal();
    await foldersLoaded();

    await user.type(screen.getByLabelText("Title"), "  Spaced Title  ");
    const tagsInput = screen.getByLabelText("Tags");
    await user.type(tagsInput, "#infra{Enter}");
    await user.type(tagsInput, "perf,");

    await user.click(screen.getByRole("button", { name: "Create note" }));

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith({
      title: "Spaced Title",
      type: "topic",
      tags: ["infra", "perf"],
      folder: "",
    });
    expect(onCreated).toHaveBeenCalledWith(note);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits the backend value 'person' for the Person chip and the selected nested folder", async () => {
    const user = userEvent.setup();
    createNote.mockResolvedValue(mkNote({ type: "person" }));
    renderModal();
    await foldersLoaded();

    await user.type(screen.getByLabelText("Title"), "Ada");
    await user.click(screen.getByRole("radio", { name: "Person" }));
    await user.selectOptions(
      screen.getByLabelText("Folder"),
      "projects/clients",
    );

    await user.click(screen.getByRole("button", { name: "Create note" }));

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith({
      title: "Ada",
      type: "person",
      tags: [],
      folder: "projects/clients",
    });
  });

  it("submits on Ctrl+Enter from the tags input, including the uncommitted draft tag", async () => {
    const user = userEvent.setup();
    const note = mkNote();
    createNote.mockResolvedValue(note);
    const { onClose, onCreated } = renderModal();
    await foldersLoaded();

    await user.type(screen.getByLabelText("Title"), "Keyboard Note");
    const tagsInput = screen.getByLabelText("Tags");
    await user.type(tagsInput, "ml");
    await user.type(tagsInput, "{Control>}{Enter}{/Control}");

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Keyboard Note", tags: ["ml"] }),
    );
    expect(onCreated).toHaveBeenCalledWith(note);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an error and keeps the modal open when createNote rejects", async () => {
    const user = userEvent.setup();
    createNote.mockRejectedValue(new Error("Create failed: boom"));
    const { onClose, onCreated } = renderModal();
    await foldersLoaded();

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

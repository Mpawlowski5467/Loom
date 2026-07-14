import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { ThreadView } from "./ThreadView";
import type { Note } from "../data/types";
import type { NoteRecord } from "../api/notes";

// --- Mock the notes API network calls; keep the real pure transforms. ---
const { updateNote, archiveNote } = vi.hoisted(() => ({
  updateNote: vi.fn(),
  archiveNote: vi.fn(),
}));

vi.mock("../api/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/notes")>();
  return { ...actual, updateNote, archiveNote };
});

function mkNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "thr_1",
    title: "Caching strategy",
    type: "topic",
    folder: "topics",
    filename: "caching.md",
    tags: ["perf", "infra"],
    body: "Lead line.\n\n## Section A\n\nDetail about [[Embeddings]].",
    links: [],
    history: [
      { action: "created", by: "you", at: "2026-05-01T09:00:00Z" },
      {
        action: "edited",
        by: "agent:weaver",
        at: "2026-05-02T10:30:00Z",
        reason: "linked refs",
      },
    ],
    created: "2026-05-01T09:00:00Z",
    modified: "2026-05-02T10:30:00Z",
    status: "active",
    source: "manual",
    ...overrides,
  };
}

function mkRecord(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: "thr_1",
    title: "Caching strategy",
    type: "topic",
    tags: ["perf", "infra"],
    created: "2026-05-01T09:00:00Z",
    modified: "2026-05-02T10:30:00Z",
    author: "you",
    source: "manual",
    links: [],
    status: "active",
    history: [],
    file_path: "/v/threads/topics/caching.md",
    body: "Lead line.",
    wikilinks: [],
    ...overrides,
  };
}

interface Spies {
  openNote: ReturnType<typeof vi.fn>;
  updateNote: ReturnType<typeof vi.fn>;
  removeNote: ReturnType<typeof vi.fn>;
  pushToast: ReturnType<typeof vi.fn>;
  setTab: ReturnType<typeof vi.fn>;
  setEditing: ReturnType<typeof vi.fn>;
  setPrimaryOpen: ReturnType<typeof vi.fn>;
  setSecondaryOpen: ReturnType<typeof vi.fn>;
}

function renderThread(
  opts: {
    note?: Note | null;
    notes?: Note[];
    editing?: boolean;
    primaryOpen?: boolean;
    secondaryOpen?: boolean;
    backlinks?: string[];
    extraNotes?: Note[];
  } = {},
): Spies {
  const note = opts.note === undefined ? mkNote() : opts.note;
  const allNotes =
    opts.notes ?? (note ? [note, ...(opts.extraNotes ?? [])] : []);
  const byId = new Map(allNotes.map((n) => [n.id, n]));

  const spies: Spies = {
    openNote: vi.fn(),
    updateNote: vi.fn(),
    removeNote: vi.fn(),
    pushToast: vi.fn(),
    setTab: vi.fn(),
    setEditing: vi.fn(),
    setPrimaryOpen: vi.fn(),
    setSecondaryOpen: vi.fn(),
  };

  const value = {
    currentNoteId: note?.id ?? null,
    notes: allNotes,
    noteById: (id: string) => byId.get(id),
    backlinksFor: () => opts.backlinks ?? [],
    primaryOpen: opts.primaryOpen ?? false,
    secondaryOpen: opts.secondaryOpen ?? false,
    editing: opts.editing ?? false,
    // Wikilinks rendered inside the body/sidebars resolve through context.
    resolveWikilink: (raw: string) =>
      allNotes.find((n) => n.title.toLowerCase() === raw.toLowerCase())?.id,
    setNewNoteOpen: vi.fn(),
    setNewNoteTitle: vi.fn(),
    ...spies,
  } as unknown as AppContextValue;

  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <ThreadView />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return spies;
}

/** The note title — rendered as an h1 with role="button" (click to rename). */
function titleButton(name = "Caching strategy"): HTMLElement {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  updateNote.mockReset();
  archiveNote.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThreadView — empty state", () => {
  it("prompts to open a note when none is selected", () => {
    renderThread({ note: null });
    expect(screen.getByText(/No note selected/)).toBeInTheDocument();
  });
});

describe("ThreadView — header", () => {
  it("renders the title, type, tags and modified date", () => {
    renderThread();
    // The title h1 carries role="button" (click-to-rename).
    expect(titleButton()).toBeInTheDocument();
    expect(screen.getByText("#perf")).toBeInTheDocument();
    expect(screen.getByText("#infra")).toBeInTheDocument();
    expect(screen.getByText("modified 2026-05-02")).toBeInTheDocument();
  });

  it("renders the note body as markdown when not editing", () => {
    renderThread();
    expect(
      screen.getByRole("heading", { name: "Section A" }),
    ).toBeInTheDocument();
  });
});

describe("ThreadView — title rename", () => {
  it("swaps the title for an input on click and saves via the API", async () => {
    const user = userEvent.setup();
    updateNote.mockResolvedValue(mkRecord({ title: "New title" }));
    const spies = renderThread();

    await user.click(titleButton());
    const input = screen.getByLabelText("Note title");
    await user.clear(input);
    await user.type(input, "New title{Enter}");

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith("thr_1", {
        title: "New title",
        base_modified: "2026-05-02T10:30:00Z",
      }),
    );
    expect(spies.updateNote).toHaveBeenCalled();
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Renamed to [[New title]]" }),
    );
  });

  it("does not call the API when the title is unchanged", async () => {
    const user = userEvent.setup();
    const spies = renderThread();
    await user.click(titleButton());
    const input = screen.getByLabelText("Note title");
    await user.type(input, "{Enter}"); // submit without editing
    expect(updateNote).not.toHaveBeenCalled();
    expect(spies.updateNote).not.toHaveBeenCalled();
  });

  it("cancels the rename on Escape without saving", async () => {
    const user = userEvent.setup();
    renderThread();
    await user.click(titleButton());
    const input = screen.getByLabelText("Note title");
    await user.type(input, "scratch{Escape}");
    expect(updateNote).not.toHaveBeenCalled();
    expect(titleButton()).toBeInTheDocument();
  });
});

describe("ThreadView — editing", () => {
  it("shows the source textarea and a live preview when editing", () => {
    renderThread({ editing: true });
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue(
      "Lead line.\n\n## Section A\n\nDetail about [[Embeddings]].",
    );
    expect(screen.getByText("SOURCE · MARKDOWN")).toBeInTheDocument();
    expect(screen.getByText("PREVIEW · RENDERED")).toBeInTheDocument();
  });

  it("keeps Save disabled until the draft diverges from the note body", async () => {
    const user = userEvent.setup();
    renderThread({ editing: true });
    const save = screen.getByRole("button", { name: /Save note/ });
    expect(save).toBeDisabled();
    await user.type(screen.getByRole("textbox"), " more");
    expect(save).toBeEnabled();
  });

  it("persists the edited body and toasts on a successful save", async () => {
    const user = userEvent.setup();
    updateNote.mockResolvedValue(mkRecord({ title: "Caching strategy" }));
    const spies = renderThread({ editing: true });

    await user.type(screen.getByRole("textbox"), " extra");
    await user.click(screen.getByRole("button", { name: /Save note/ }));

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith("thr_1", {
        body: "Lead line.\n\n## Section A\n\nDetail about [[Embeddings]]. extra",
        base_modified: "2026-05-02T10:30:00Z",
      }),
    );
    expect(spies.updateNote).toHaveBeenCalled();
    expect(spies.setEditing).toHaveBeenCalledWith(false);
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ icon: "✓" }),
    );
  });

  it("keeps the draft's base version when SSE refreshes the open note", async () => {
    const user = userEvent.setup();
    const original = mkNote({
      body: "Original body",
      modified: "2026-05-02T10:30:00Z",
    });
    updateNote.mockResolvedValue(
      mkRecord({
        body: "Original body — local",
        modified: "2026-05-02T10:32:00Z",
      }),
    );

    function Harness(): ReactNode {
      const [liveNote, setLiveNote] = useState(original);
      const [editing, setEditing] = useState(true);
      const value = {
        currentNoteId: liveNote.id,
        notes: [liveNote],
        noteById: () => liveNote,
        backlinksFor: () => [],
        primaryOpen: false,
        secondaryOpen: false,
        editing,
        setEditing,
        openNote: vi.fn(),
        updateNote: vi.fn(),
        removeNote: vi.fn(),
        pushToast: vi.fn(),
        setTab: vi.fn(),
        setPrimaryOpen: vi.fn(),
        setSecondaryOpen: vi.fn(),
        resolveWikilink: () => undefined,
        setNewNoteOpen: vi.fn(),
        setNewNoteTitle: vi.fn(),
      } as unknown as AppContextValue;
      return (
        <AppCtx.Provider value={value}>
          <ThreadView />
          <button
            type="button"
            onClick={() =>
              setLiveNote((current) => ({
                ...current,
                body: "Remote agent body",
                modified: "2026-05-02T10:31:00Z",
              }))
            }
          >
            Simulate remote edit
          </button>
        </AppCtx.Provider>
      );
    }

    render(<Harness />);
    await user.type(screen.getByRole("textbox"), " — local");
    await user.click(
      screen.getByRole("button", { name: "Simulate remote edit" }),
    );
    await user.click(screen.getByRole("button", { name: /Save note/ }));

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith("thr_1", {
        body: "Original body — local",
        base_modified: "2026-05-02T10:30:00Z",
      }),
    );
  });

  it("surfaces a failure toast and stays in edit mode when the save fails", async () => {
    const user = userEvent.setup();
    updateNote.mockRejectedValue(new Error("disk full"));
    const spies = renderThread({ editing: true });

    await user.type(screen.getByRole("textbox"), " extra");
    await user.click(screen.getByRole("button", { name: /Save note/ }));

    await waitFor(() =>
      expect(spies.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("disk full") }),
      ),
    );
    expect(spies.setEditing).not.toHaveBeenCalled();
  });
});

describe("ThreadView — archive", () => {
  it("opens an accessible confirm dialog instead of window.confirm", async () => {
    const user = userEvent.setup();
    renderThread();

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Archive note" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent(/Archive "Caching strategy"\?/);
  });

  it("archives after confirming, removes the note, and returns to the graph", async () => {
    const user = userEvent.setup();
    archiveNote.mockResolvedValue({ status: "archived", path: "x" });
    const spies = renderThread();

    await user.click(screen.getByRole("button", { name: "Archive note" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(archiveNote).toHaveBeenCalledWith("thr_1", "2026-05-02T10:30:00Z"),
    );
    expect(spies.removeNote).toHaveBeenCalledWith("thr_1");
    expect(spies.setTab).toHaveBeenCalledWith("graph");
    expect(spies.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "archivist" }),
    );
  });

  it("does nothing when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const spies = renderThread();

    await user.click(screen.getByRole("button", { name: "Archive note" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(archiveNote).not.toHaveBeenCalled();
    expect(spies.removeNote).not.toHaveBeenCalled();
  });

  it("cancels the archive dialog on Escape", async () => {
    const user = userEvent.setup();
    renderThread();

    await user.click(screen.getByRole("button", { name: "Archive note" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(archiveNote).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the error when archiving fails", async () => {
    const user = userEvent.setup();
    archiveNote.mockRejectedValue(new Error("disk full"));
    const spies = renderThread();

    await user.click(screen.getByRole("button", { name: "Archive note" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));

    await screen.findByText("disk full");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(spies.removeNote).not.toHaveBeenCalled();
  });
});

describe("ThreadView — details sidebar", () => {
  it("lists edit history newest-first and the tags", () => {
    renderThread({ primaryOpen: true });
    expect(screen.getByText("Edit history")).toBeInTheDocument();
    // The agent edit (with a reason) is shown.
    expect(screen.getByText(/linked refs/)).toBeInTheDocument();
    expect(screen.getByText("WEAVER")).toBeInTheDocument();
    expect(screen.getByText("YOU")).toBeInTheDocument();
  });

  it("shows a backlinks empty state when there are none", () => {
    renderThread({ primaryOpen: true, backlinks: [] });
    expect(screen.getByText("no backlinks yet")).toBeInTheDocument();
  });

  it("renders backlinks to other notes", () => {
    const other = mkNote({ id: "thr_2", title: "Embeddings" });
    renderThread({
      primaryOpen: true,
      backlinks: ["thr_2"],
      extraNotes: [other],
    });
    expect(screen.getByText("Backlinks")).toBeInTheDocument();
    expect(screen.getAllByText("Embeddings").length).toBeGreaterThan(0);
  });
});

describe("ThreadView — context sidebar", () => {
  it("lists the note's outline headings", () => {
    renderThread({ secondaryOpen: true });
    expect(screen.getByText("Outline")).toBeInTheDocument();
    // "Section A" also appears as a body heading; scope to the outline row.
    const outlineRow = document.querySelector(".outline-row");
    expect(outlineRow?.textContent).toContain("Section A");
  });

  it("opens a related note when its row is clicked", async () => {
    const user = userEvent.setup();
    const related = mkNote({ id: "thr_2", title: "Embeddings" });
    const note = mkNote({ links: ["thr_2"] });
    const spies = renderThread({
      note,
      secondaryOpen: true,
      extraNotes: [related],
    });

    expect(screen.getByText("Related")).toBeInTheDocument();
    // "Embeddings" is also a body wikilink; click the related-row button.
    const relatedRow = document.querySelector(".related-row") as HTMLElement;
    await user.click(relatedRow);
    expect(spies.openNote).toHaveBeenCalledWith("thr_2");
  });

  it("hides the context sidebar while editing", () => {
    renderThread({ secondaryOpen: true, editing: true });
    expect(screen.queryByText("Outline")).not.toBeInTheDocument();
  });
});

describe("ThreadView — discard-unsaved guard", () => {
  /**
   * Stateful harness: a real ``currentNoteId`` + ``openNote`` so the unsaved-
   * edit guard (which reverts navigation via ``openNote``) can be exercised.
   */
  function renderSwitchable(noteA: Note, noteB: Note) {
    const byId = new Map([noteA, noteB].map((n) => [n.id, n]));
    const openNote = vi.fn();

    function Harness(): ReactNode {
      const [currentId, setCurrentId] = useState(noteA.id);
      openNote.mockImplementation((id: string) => setCurrentId(id));
      const value = {
        currentNoteId: currentId,
        notes: [noteA, noteB],
        noteById: (id: string) => byId.get(id),
        backlinksFor: () => [],
        primaryOpen: false,
        secondaryOpen: false,
        editing: true, // start in edit mode so the guard can fire
        resolveWikilink: () => undefined,
        openNote,
        updateNote: vi.fn(),
        removeNote: vi.fn(),
        pushToast: vi.fn(),
        setTab: vi.fn(),
        setEditing: vi.fn(),
        setPrimaryOpen: vi.fn(),
        setSecondaryOpen: vi.fn(),
        setNewNoteOpen: vi.fn(),
        setNewNoteTitle: vi.fn(),
      } as unknown as AppContextValue;
      return (
        <AppCtx.Provider value={value}>
          <ThreadView />
          <button onClick={() => setCurrentId(noteB.id)}>switch-to-B</button>
        </AppCtx.Provider>
      );
    }
    render(<Harness />);
    return { openNote };
  }

  it("prompts before discarding unsaved edits and reverts on cancel", async () => {
    const user = userEvent.setup();
    const a = mkNote({ id: "thr_a", title: "Note A", body: "A body" });
    const b = mkNote({ id: "thr_b", title: "Note B", body: "B body" });
    const { openNote } = renderSwitchable(a, b);

    // Diverge the draft from Note A's body.
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "A body — edited");

    // Attempt to switch to Note B.
    await user.click(screen.getByRole("button", { name: "switch-to-B" }));

    // The guard reverts navigation back to A and opens the discard dialog.
    expect(openNote).toHaveBeenCalledWith("thr_a");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Discard unsaved changes in "Note A"\?/);

    // Cancel: dialog closes, we stay on A (the edited draft is still shown).
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("A body — edited");
  });

  it("navigates to the target note when discard is confirmed", async () => {
    const user = userEvent.setup();
    const a = mkNote({ id: "thr_a", title: "Note A", body: "A body" });
    const b = mkNote({ id: "thr_b", title: "Note B", body: "B body" });
    const { openNote } = renderSwitchable(a, b);

    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "A body — edited");

    await user.click(screen.getByRole("button", { name: "switch-to-B" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));

    // Confirm re-navigates to B (guard bypassed) and the dialog is gone.
    expect(openNote).toHaveBeenCalledWith("thr_b");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

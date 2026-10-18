import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { acceptConnection, getConnections } from "@/api/connections";
import {
  archiveNote,
  updateNote as apiUpdateNote,
  type NoteRecord,
} from "@/api/notes";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import { supersessionSeed } from "@/data/notesSupersession";
import type { Note } from "@/data/types";
import { buildWikilinkMap, linkTarget } from "@/data/wikilinks";
import { TestAppearanceProvider } from "@/test/appearance";
import { NotesView } from "./NotesView";

vi.mock("@/api/notes", async (orig) => ({
  ...(await orig<typeof import("@/api/notes")>()),
  updateNote: vi.fn(),
  archiveNote: vi.fn(),
  getNote: vi.fn(),
}));
vi.mock("@/api/history", async (orig) => ({
  ...(await orig<typeof import("@/api/history")>()),
  listHistory: vi.fn(async () => []),
  getHistoryStatus: vi.fn(async () => ({ enabled: false, reason: "off" })),
}));
vi.mock("@/api/related", () => ({
  getRelatedNotes: vi.fn(async () => ({ items: [], source: "related" })),
}));
vi.mock("@/api/connections", async (orig) => ({
  ...(await orig<typeof import("@/api/connections")>()),
  getConnections: vi.fn(),
  acceptConnection: vi.fn(async () => ({ status: "accepted" })),
  dismissConnection: vi.fn(async () => true),
}));
vi.mock("@/data/demoMode", () => ({ readDemoMode: () => false }));

const notes = supersessionSeed;
const v2 = notes[1]!;

function record(note: Note, patch: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: note.id,
    title: note.title,
    type: note.type,
    tags: note.tags,
    created: note.created,
    modified: "2026-05-20T00:00:00Z",
    content_version: "v2",
    author: "you",
    source: "manual",
    links: [],
    status: "active",
    history: [],
    file_path: `/v/threads/${note.folder}/${note.filename}`,
    body: note.body,
    wikilinks: [],
    extra: note.extra,
    ...patch,
  };
}

function renderNotes(over: Partial<AppContextValue> = {}) {
  const map = buildWikilinkMap(notes);
  const ctx = {
    notes,
    notesLoaded: true,
    currentNoteId: v2.id,
    noteById: (id: string) => notes.find((n) => n.id === id),
    resolveWikilink: (raw: string) => map.get(linkTarget(raw)),
    backlinksFor: () => [],
    wikilinkMap: map,
    config: { active_vault: "v" },
    extraFolders: [],
    updateNote: vi.fn(),
    removeNote: vi.fn(),
    pushToast: vi.fn(),
    setTab: vi.fn(),
    openNote: vi.fn(),
    setCouncilPrefill: vi.fn(),
    setGraphSelectedId: vi.fn(),
    flyToNode: vi.fn(),
    ...over,
  } as unknown as AppContextValue;
  render(
    <MemoryRouter>
      <TestAppearanceProvider>
        <AppCtx.Provider value={ctx}>
          <NotesView />
        </AppCtx.Provider>
      </TestAppearanceProvider>
    </MemoryRouter>,
  );
  return ctx;
}

describe("NotesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("loom.notes.sourceMode", "1");
    vi.mocked(getConnections).mockResolvedValue({
      note_id: v2.id,
      connections: [],
    });
  });

  it("shows the title, properties and supersession banner", () => {
    renderNotes();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Cache plan v2",
    );
    expect(screen.getByText("current")).toBeInTheDocument();
    const validFrom = screen.getByText("Valid from").nextElementSibling;
    expect(validFrom).toHaveTextContent("2026-05-10");
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/Supersedes cache-plan-v1/);
    expect(banner).toHaveTextContent(/superseded on 2026-05-12/);
  });

  it("explains a note that no longer exists", () => {
    renderNotes({ currentNoteId: null });
    expect(screen.getByText("Note not found")).toBeInTheDocument();
  });

  it("renames from the title", async () => {
    vi.mocked(apiUpdateNote).mockResolvedValue(
      record(v2, { title: "Cache plan v3" }),
    );
    const user = userEvent.setup();
    const ctx = renderNotes();
    await user.click(screen.getByRole("button", { name: "Cache plan v2" }));
    const input = screen.getByRole("textbox", { name: "Note title" });
    await user.clear(input);
    await user.type(input, "Cache plan v3{Enter}");
    expect(apiUpdateNote).toHaveBeenCalledWith(v2.id, {
      title: "Cache plan v3",
      base_modified: v2.modified,
    });
    expect(ctx.updateNote).toHaveBeenCalled();
  });

  it("adds a tag", async () => {
    vi.mocked(apiUpdateNote).mockResolvedValue(record(v2));
    const user = userEvent.setup();
    renderNotes();
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.type(
      screen.getByRole("textbox", { name: "Add tag" }),
      "latency{Enter}",
    );
    expect(apiUpdateNote).toHaveBeenCalledWith(v2.id, {
      tags: [...v2.tags, "latency"],
      base_modified: v2.modified,
    });
  });

  it("saves markdown edits with the version they started from", async () => {
    vi.mocked(apiUpdateNote).mockResolvedValue(
      record(v2, { body: `${v2.body}!` }),
    );
    const user = userEvent.setup();
    renderNotes();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Note body (markdown)" }),
      "!",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(apiUpdateNote).toHaveBeenCalledWith(v2.id, {
      body: `${v2.body}!`,
      base_modified: v2.modified,
    });
  });

  it("keeps the draft and offers conflict actions on a 409", async () => {
    vi.mocked(apiUpdateNote).mockRejectedValue(new ApiError("stale", 409));
    const user = userEvent.setup();
    renderNotes();
    await user.type(
      screen.getByRole("textbox", { name: "Note body (markdown)" }),
      "!",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByText("Version conflict");
    const box = alert.closest("[role=alert]") as HTMLElement;
    for (const name of [
      "Compare",
      "Reload remote",
      "Keep draft",
      "Overwrite remote",
    ])
      expect(within(box).getByRole("button", { name })).toBeInTheDocument();
  });

  it("archives after confirmation", async () => {
    vi.mocked(archiveNote).mockResolvedValue({ status: "archived", path: "x" });
    const user = userEvent.setup();
    const ctx = renderNotes();
    await user.click(screen.getByRole("button", { name: "More note actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Archive note" }),
    );
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(archiveNote).toHaveBeenCalledWith(v2.id, v2.modified),
    );
    expect(ctx.setTab).toHaveBeenCalledWith("graph");
  });

  it("asks the Council about the note", async () => {
    const user = userEvent.setup();
    const ctx = renderNotes();
    await user.click(screen.getByRole("button", { name: "Ask Council" }));
    expect(ctx.setCouncilPrefill).toHaveBeenCalledWith(
      "About [[Cache plan v2]]: ",
    );
    expect(ctx.setTab).toHaveBeenCalledWith("board");
  });

  it("offers Spider's suggestions and links one", async () => {
    vi.mocked(getConnections).mockResolvedValue({
      note_id: v2.id,
      connections: [
        {
          direction: "outgoing",
          source_id: v2.id,
          target_id: "thr_t101",
          target_title: "Latency budget",
          state: "suggested",
          method: "embedding",
          rationale: "Both notes set p95 targets.",
          source_excerpt: "",
          target_excerpt: "",
          score: 0.68,
          created: "",
          agent: "spider",
          source_modified: "s1",
          target_modified: "t1",
        },
      ],
    });
    const user = userEvent.setup();
    renderNotes();
    const card = await screen.findByText(/Spider suggests linking/);
    expect(card).toHaveTextContent("Both notes set p95 targets.");
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(acceptConnection).toHaveBeenCalledWith({
      source_id: v2.id,
      target_id: "thr_t101",
      source_modified: "s1",
      target_modified: "t1",
    });
  });

  it("renders the body in the rich editor with wikilink chips", async () => {
    localStorage.setItem("loom.notes.sourceMode", "0");
    renderNotes();
    const body = await screen.findByRole("textbox", { name: "Note body" });
    expect(body).toHaveTextContent("Second plan for the read cache");
    expect(body.querySelector('[data-wikilink="Webhooks"]')).toHaveTextContent(
      "Webhooks",
    );
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient } from "./client";
import {
  backendNoteToFrontend,
  backendNotesToFrontend,
  titleMapFromNotes,
  titleMapFromRecords,
  notePathOf,
  loadAllNotes,
  type NoteRecord,
} from "./notes";
import type { Note } from "../data/types";

function mkRecord(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: "thr_1",
    title: "Caching",
    type: "topic",
    tags: ["perf"],
    created: "2026-05-01T00:00:00Z",
    modified: "2026-05-02T00:00:00Z",
    author: "you",
    source: "manual",
    links: [],
    status: "active",
    history: [{ action: "created", by: "you", at: "2026-05-01T00:00:00Z" }],
    file_path: "/v/threads/topics/caching.md",
    body: "Body text",
    wikilinks: [],
    ...overrides,
  };
}

describe("backendNoteToFrontend", () => {
  it("maps core fields and derives folder/filename from the path", () => {
    const note = backendNoteToFrontend(mkRecord());
    expect(note.id).toBe("thr_1");
    expect(note.title).toBe("Caching");
    expect(note.type).toBe("topic");
    expect(note.folder).toBe("topics");
    expect(note.filename).toBe("caching.md");
    expect(note.body).toBe("Body text");
  });

  it("derives a nested folder from a deep path", () => {
    const note = backendNoteToFrontend(
      mkRecord({ file_path: "/v/threads/projects/loom/spec.md" }),
    );
    expect(note.folder).toBe("projects/loom");
    expect(note.filename).toBe("spec.md");
  });

  it("normalizes the legacy 'person' type to 'people'", () => {
    expect(backendNoteToFrontend(mkRecord({ type: "person" })).type).toBe(
      "people",
    );
  });

  it("falls back to 'custom' for an unknown type", () => {
    expect(backendNoteToFrontend(mkRecord({ type: "weird" })).type).toBe(
      "custom",
    );
  });

  it("treats an archived record as archived, everything else as active", () => {
    expect(backendNoteToFrontend(mkRecord({ status: "archived" })).status).toBe(
      "archived",
    );
    expect(backendNoteToFrontend(mkRecord({ status: "draft" })).status).toBe(
      "active",
    );
  });

  it("maps history entries through", () => {
    const note = backendNoteToFrontend(
      mkRecord({
        history: [
          { action: "edited", by: "agent:weaver", at: "t", reason: "why" },
        ],
      }),
    );
    expect(note.history).toEqual([
      { action: "edited", by: "agent:weaver", at: "t", reason: "why" },
    ]);
  });

  it("resolves links and wikilinks to note ids via the title map", () => {
    const titleToId = new Map([
      ["embeddings", "thr_2"],
      ["search", "thr_3"],
    ]);
    const note = backendNoteToFrontend(
      mkRecord({ links: ["Embeddings"], wikilinks: ["search#section"] }),
      titleToId,
    );
    expect(note.links.sort()).toEqual(["thr_2", "thr_3"]);
  });

  it("does not link a note to itself", () => {
    const titleToId = new Map([["caching", "thr_1"]]);
    const note = backendNoteToFrontend(
      mkRecord({ wikilinks: ["Caching"] }),
      titleToId,
    );
    expect(note.links).not.toContain("thr_1");
  });

  it("strips alias and anchor suffixes when resolving links", () => {
    const titleToId = new Map([["embeddings", "thr_2"]]);
    const note = backendNoteToFrontend(
      mkRecord({ wikilinks: ["Embeddings|see this#part"] }),
      titleToId,
    );
    expect(note.links).toEqual(["thr_2"]);
  });
});

describe("backendNotesToFrontend", () => {
  it("cross-resolves wikilinks across the batch", () => {
    const records = [
      mkRecord({ id: "a", title: "Alpha", file_path: "/v/threads/topics/alpha.md", wikilinks: ["Beta"] }),
      mkRecord({ id: "b", title: "Beta", file_path: "/v/threads/topics/beta.md" }),
    ];
    const notes = backendNotesToFrontend(records);
    const alpha = notes.find((n) => n.id === "a")!;
    expect(alpha.links).toContain("b");
  });
});

describe("titleMapFromNotes", () => {
  it("maps lowercased titles to ids", () => {
    const notes = [
      { id: "x", title: "Hello World" },
      { id: "y", title: "Foo" },
    ] as Note[];
    const map = titleMapFromNotes(notes);
    expect(map.get("hello world")).toBe("x");
    expect(map.get("foo")).toBe("y");
  });
});

describe("titleMapFromRecords", () => {
  it("maps both the filename slug and the title to the id", () => {
    const map = titleMapFromRecords([
      mkRecord({ id: "thr_1", title: "Caching", file_path: "/v/threads/topics/caching.md" }),
    ]);
    expect(map.get("caching")).toBe("thr_1"); // slug
    expect(map.get("caching")).toBe("thr_1"); // title (same here)
  });

  it("keeps the first id for a duplicated key", () => {
    const map = titleMapFromRecords([
      mkRecord({ id: "first", title: "Dup", file_path: "/v/threads/topics/dup.md" }),
      mkRecord({ id: "second", title: "Dup", file_path: "/v/threads/topics/other.md" }),
    ]);
    expect(map.get("dup")).toBe("first");
  });
});

describe("notePathOf", () => {
  it("uses the explicit filename when present", () => {
    expect(notePathOf({ folder: "topics", filename: "x.md", title: "X" })).toBe(
      "topics/x.md",
    );
  });

  it("kebab-cases the title into a filename when none is given", () => {
    expect(notePathOf({ folder: "topics", title: "Hello World!" })).toBe(
      "topics/hello-world.md",
    );
  });

  it("omits the folder prefix for root notes", () => {
    expect(notePathOf({ folder: "", title: "Loose" })).toBe("loose.md");
  });

  it("falls back to 'note.md' when the title kebabs to empty", () => {
    expect(notePathOf({ folder: "", title: "!!!" })).toBe("note.md");
  });
});

describe("loadAllNotes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pages through the bulk endpoint, accumulating full notes", async () => {
    const getSpy = vi.spyOn(apiClient, "get");
    // Bulk page 1 returns 2 of 3 notes; page 2 returns the last.
    getSpy.mockImplementation((path: string) => {
      if (path.startsWith("/api/notes/bulk?offset=0")) {
        return Promise.resolve({
          notes: [mkRecord({ id: "a" }), mkRecord({ id: "b" })],
          total: 3,
          offset: 0,
          limit: 500,
        });
      }
      if (path.startsWith("/api/notes/bulk?offset=2")) {
        return Promise.resolve({
          notes: [mkRecord({ id: "c" })],
          total: 3,
          offset: 2,
          limit: 500,
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const records = await loadAllNotes();
    expect(records.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    // No per-note N+1 — only the two bulk page requests.
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it("stops when a page returns no notes", async () => {
    const getSpy = vi.spyOn(apiClient, "get");
    getSpy.mockResolvedValue({ notes: [], total: 99, offset: 0, limit: 500 });
    const records = await loadAllNotes();
    expect(records).toEqual([]);
  });

  it("returns whatever the bulk endpoint provides (server skips bad notes)", async () => {
    const getSpy = vi.spyOn(apiClient, "get");
    // The backend bulk endpoint drops an unreadable note server-side, so the
    // client simply gets the survivors — no client-side per-note skipping.
    getSpy.mockResolvedValue({
      notes: [mkRecord({ id: "a" }), mkRecord({ id: "c" })],
      total: 2,
      offset: 0,
      limit: 500,
    });

    const records = await loadAllNotes();
    expect(records.map((r) => r.id).sort()).toEqual(["a", "c"]);
  });

  it("propagates an AbortError so a cancelled load surfaces", async () => {
    const getSpy = vi.spyOn(apiClient, "get");
    getSpy.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(loadAllNotes()).rejects.toMatchObject({ name: "AbortError" });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient } from "./client";
import {
  backendNoteToFrontend,
  backendNotesToFrontend,
  titleMapFromNotes,
  titleMapFromRecords,
  notePathOf,
  loadNoteSummaries,
  archiveNote,
  updateNote,
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

it("loads metadata pages and graph edges without requesting any note body", async () => {
  const get = vi.spyOn(apiClient, "get").mockImplementation(async (path) => {
    if (path === "/api/graph")
      return { edges: [{ source: "n0", target: "n200" }] };
    const offset = new URL(path, "http://localhost").searchParams.get("offset");
    const start = Number(offset);
    expect(path).toContain("limit=200");
    return {
      notes: Array.from({ length: start === 0 ? 200 : 1 }, (_, i) => {
        const record = mkRecord({ id: `n${start + i}`, body: "" });
        return Object.fromEntries(
          Object.entries(record).filter(
            ([key]) => key !== "body" && key !== "wikilinks",
          ),
        );
      }),
      total: 201,
    };
  });
  try {
    const notes = await loadNoteSummaries();
    expect(notes).toHaveLength(201);
    expect(notes[0]?.links).toEqual(["n200"]);
    expect(
      notes.every((note) => note.body === "" && note.bodyLoaded === false),
    ).toBe(true);
    expect(get.mock.calls.map((call) => call[0]).sort()).toEqual([
      "/api/graph",
      "/api/notes?offset=0&limit=200",
      "/api/notes?offset=200&limit=200",
    ]);
  } finally {
    get.mockRestore();
  }
});

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
      mkRecord({
        id: "a",
        title: "Alpha",
        file_path: "/v/threads/topics/alpha.md",
        wikilinks: ["Beta"],
      }),
      mkRecord({
        id: "b",
        title: "Beta",
        file_path: "/v/threads/topics/beta.md",
      }),
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
      mkRecord({
        id: "thr_1",
        title: "Caching",
        file_path: "/v/threads/topics/caching.md",
      }),
    ]);
    expect(map.get("caching")).toBe("thr_1"); // slug
    expect(map.get("caching")).toBe("thr_1"); // title (same here)
  });

  it("refuses an ambiguous duplicated key", () => {
    const map = titleMapFromRecords([
      mkRecord({
        id: "first",
        title: "Dup",
        file_path: "/v/threads/topics/dup.md",
      }),
      mkRecord({
        id: "second",
        title: "Dup",
        file_path: "/v/threads/topics/other.md",
      }),
    ]);
    expect(map.get("dup")).toBeUndefined();
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

describe("note mutation requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes the note id and forwards optimistic update metadata", async () => {
    const put = vi.spyOn(apiClient, "put").mockResolvedValue(mkRecord());

    await updateNote("note/with spaces", {
      title: "New title",
      base_modified: "2026-07-14T12:34:56+00:00",
    });

    expect(put).toHaveBeenCalledWith("/api/notes/note%2Fwith%20spaces", {
      title: "New title",
      base_modified: "2026-07-14T12:34:56+00:00",
    });
  });

  it("encodes archive ids and the optional base-modified query", async () => {
    const del = vi.spyOn(apiClient, "delete").mockResolvedValue({
      status: "archived",
      path: "threads/.archive/note.md",
    });

    await archiveNote("note/with spaces", "2026-07-14T12:34:56+00:00");
    await archiveNote("plain");

    expect(del).toHaveBeenNthCalledWith(
      1,
      "/api/notes/note%2Fwith%20spaces?base_modified=2026-07-14T12%3A34%3A56%2B00%3A00",
    );
    expect(del).toHaveBeenNthCalledWith(2, "/api/notes/plain");
  });
});

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import {
  getNote,
  updateNote as apiUpdateNote,
  type NoteRecord,
} from "@/api/notes";
import type { Note } from "@/data/types";
import { readNoteDraft, writeNoteDraft } from "@/editor/noteDraftStorage";
import { useNoteDraft } from "./useNoteDraft";

vi.mock("@/api/notes", async (orig) => ({
  ...(await orig<typeof import("@/api/notes")>()),
  updateNote: vi.fn(),
  getNote: vi.fn(),
}));

const base: Note = {
  id: "n1",
  title: "Cache plan",
  type: "project",
  folder: "projects",
  filename: "cache-plan.md",
  tags: [],
  body: "Original body.",
  links: [],
  history: [],
  created: "2026-05-01T00:00:00Z",
  modified: "2026-05-01T00:00:00Z",
  contentVersion: "v1",
  status: "active",
  source: "manual",
};

const record = (body: string, version: string): NoteRecord => ({
  id: "n1",
  title: "Cache plan",
  type: "project",
  tags: [],
  created: base.created,
  modified: "2026-05-02T00:00:00Z",
  content_version: version,
  author: "you",
  source: "manual",
  links: [],
  status: "active",
  history: [],
  file_path: "/v/threads/projects/cache-plan.md",
  body,
  wikilinks: [],
});

/** Holds the note in state so updateNote re-renders like AppContext does. */
function setup(note: Note = base) {
  const pushToast = vi.fn();
  const updateNote = vi.fn();
  const hook = renderHook(
    ({ n }: { n: Note }) => {
      const [current, setCurrent] = useState(n);
      const [seen, setSeen] = useState(n);
      if (seen !== n) {
        setSeen(n);
        setCurrent(n);
      }
      return useNoteDraft({
        note: current,
        vaultId: "v",
        notes: [current],
        updateNote: (next) => {
          updateNote(next);
          setCurrent(next);
        },
        pushToast,
      });
    },
    { initialProps: { n: note } },
  );
  return { ...hook, updateNote, pushToast };
}

describe("useNoteDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("starts clean and becomes dirty on edit, persisting a recovery copy", () => {
    const { result } = setup();
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setDraft("Edited body."));
    expect(result.current.dirty).toBe(true);
    expect(readNoteDraft("v", "n1")).toMatchObject({
      body: "Edited body.",
      baseModified: "v1",
    });
  });

  it("editing back to the original clears the recovery copy", () => {
    const { result } = setup();
    act(() => result.current.setDraft("x"));
    act(() => result.current.setDraft("Original body."));
    expect(result.current.dirty).toBe(false);
    expect(readNoteDraft("v", "n1")).toBeNull();
  });

  it("recovers a stored draft and flags one based on an older version", () => {
    writeNoteDraft("v", "n1", {
      body: "Recovered.",
      baseModified: "v0",
      savedAt: "",
    });
    const { result } = setup();
    expect(result.current.draft).toBe("Recovered.");
    expect(result.current.conflict?.message).toMatch(/older version/);
  });

  it("follows a remote refresh while clean", () => {
    const { result, rerender } = setup();
    const rev = result.current.revision;
    rerender({ n: { ...base, body: "Agent edit.", contentVersion: "v2" } });
    expect(result.current.draft).toBe("Agent edit.");
    expect(result.current.revision).toBe(rev + 1);
    expect(result.current.conflict).toBeNull();
  });

  it("follows a version bump without a body change (rename) while clean", async () => {
    vi.mocked(apiUpdateNote).mockResolvedValue(record("Mine.", "v3"));
    const { result, rerender } = setup();
    const rev = result.current.revision;
    rerender({ n: { ...base, title: "Renamed", contentVersion: "v2" } });
    expect(result.current.revision).toBe(rev);
    act(() => result.current.setDraft("Mine."));
    await act(() => result.current.save());
    expect(apiUpdateNote).toHaveBeenCalledWith("n1", {
      body: "Mine.",
      base_modified: "v2",
    });
  });

  it("keeps a dirty draft through a remote refresh and reports a conflict", () => {
    const { result, rerender } = setup();
    act(() => result.current.setDraft("Mine."));
    rerender({ n: { ...base, body: "Theirs.", contentVersion: "v2" } });
    expect(result.current.draft).toBe("Mine.");
    expect(result.current.conflict).toMatchObject({ remoteBody: "Theirs." });
  });

  it("saves with the base version and adopts the saved note", async () => {
    vi.mocked(apiUpdateNote).mockResolvedValue(record("Mine.", "v2"));
    const { result, updateNote } = setup();
    act(() => result.current.setDraft("Mine."));
    await act(() => result.current.save());
    expect(apiUpdateNote).toHaveBeenCalledWith("n1", {
      body: "Mine.",
      base_modified: "v1",
    });
    expect(updateNote).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Mine.", contentVersion: "v2" }),
    );
    expect(readNoteDraft("v", "n1")).toBeNull();
  });

  it("keeps the draft and explains a 409", async () => {
    vi.mocked(apiUpdateNote).mockRejectedValue(new ApiError("stale", 409));
    const { result, pushToast } = setup();
    act(() => result.current.setDraft("Mine."));
    await act(() => result.current.save());
    expect(result.current.draft).toBe("Mine.");
    expect(result.current.conflict?.message).toMatch(/newer version/);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringMatching(/conflict/i) }),
    );
  });

  it("overwrite skips the version check", async () => {
    vi.mocked(apiUpdateNote).mockResolvedValue(record("Mine.", "v3"));
    const { result } = setup();
    act(() => result.current.setDraft("Mine."));
    await act(() => result.current.save(true));
    expect(apiUpdateNote).toHaveBeenCalledWith("n1", { body: "Mine." });
  });

  it("reload replaces the draft with the remote note", async () => {
    vi.mocked(getNote).mockResolvedValue(record("Remote.", "v4"));
    const { result } = setup();
    act(() => result.current.setDraft("Mine."));
    await act(() => result.current.reloadRemote());
    expect(result.current.draft).toBe("Remote.");
  });

  it("discard restores the note body", () => {
    const { result } = setup();
    act(() => result.current.setDraft("Mine."));
    act(() => result.current.discard());
    expect(result.current.draft).toBe("Original body.");
    expect(readNoteDraft("v", "n1")).toBeNull();
  });

  it("switching notes loads that note's own draft", () => {
    const { result, rerender } = setup();
    act(() => result.current.setDraft("Draft for n1."));
    rerender({ n: { ...base, id: "n2", body: "Second note." } });
    expect(result.current.draft).toBe("Second note.");
    expect(readNoteDraft("v", "n1")?.body).toBe("Draft for n1.");
  });
});

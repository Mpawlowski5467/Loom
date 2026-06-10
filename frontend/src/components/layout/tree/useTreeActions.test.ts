import { createElement } from "react";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContextValue } from "../../../context/app-ctx";
import { AppCtx } from "../../../context/app-ctx";
import type { Note } from "../../../data/types";
import { useTreeActions } from "./useTreeActions";

// Mock only the network calls — keep the real path helpers (notePathOf) so the
// path → note resolution is exercised exactly as it runs in production.
vi.mock("../../../api/notes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../api/notes")>();
  return {
    ...actual,
    archiveTreePath: vi.fn().mockResolvedValue({ status: "ok", path: "x" }),
  };
});

import { archiveTreePath } from "../../../api/notes";

const archiveMock = vi.mocked(archiveTreePath);

function makeNote(over: Partial<Note> & Pick<Note, "id">): Note {
  return {
    id: over.id,
    title: over.title ?? over.id,
    type: over.type ?? "topic",
    folder: over.folder ?? "topics",
    filename: over.filename,
    tags: [],
    body: "",
    links: [],
    history: [],
    created: "2026-01-01",
    modified: "2026-01-01",
    status: "active",
    source: "manual",
  };
}

interface Harness {
  removeNote: ReturnType<typeof vi.fn>;
  pushToast: ReturnType<typeof vi.fn>;
  setTab: ReturnType<typeof vi.fn>;
}

function renderActions(notes: Note[], currentNoteId: string | null = null) {
  const removeNote = vi.fn();
  const pushToast = vi.fn();
  const setTab = vi.fn();
  const value = {
    notes,
    currentNoteId,
    addFolder: vi.fn(),
    pushToast,
    updateNote: vi.fn(),
    removeNote,
    setTab,
  } as unknown as AppContextValue;

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(AppCtx.Provider, { value }, children);

  const inputRef = { current: null };
  const { result } = renderHook(() => useTreeActions(inputRef), { wrapper });
  return { result, harness: { removeNote, pushToast, setTab } as Harness };
}

describe("useTreeActions.performDelete", () => {
  beforeEach(() => {
    archiveMock.mockClear();
    archiveMock.mockResolvedValue({ status: "ok", path: "x" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the single archived note by its id", async () => {
    const notes = [
      makeNote({ id: "thr_a", folder: "topics", filename: "caching.md" }),
      makeNote({ id: "thr_b", folder: "topics", filename: "other.md" }),
    ];
    const { result, harness } = renderActions(notes);

    await result.current.performDelete("topics/caching.md", "thr_a");

    await waitFor(() =>
      expect(archiveMock).toHaveBeenCalledWith("topics/caching.md"),
    );
    expect(harness.removeNote).toHaveBeenCalledTimes(1);
    expect(harness.removeNote).toHaveBeenCalledWith("thr_a");
  });

  it("falls back to matching by path when no note id is supplied", async () => {
    const notes = [
      makeNote({ id: "thr_a", folder: "topics", filename: "caching.md" }),
    ];
    const { result, harness } = renderActions(notes);

    await result.current.performDelete("topics/caching.md");

    expect(harness.removeNote).toHaveBeenCalledTimes(1);
    expect(harness.removeNote).toHaveBeenCalledWith("thr_a");
  });

  it("removes every note under an archived folder", async () => {
    const notes = [
      makeNote({ id: "thr_a", folder: "projects", filename: "alpha.md" }),
      makeNote({ id: "thr_b", folder: "projects", filename: "beta.md" }),
      makeNote({ id: "thr_c", folder: "projects/sub", filename: "deep.md" }),
      makeNote({ id: "thr_x", folder: "topics", filename: "elsewhere.md" }),
    ];
    const { result, harness } = renderActions(notes);

    // Folder archive: no note id is passed by the context menu.
    await result.current.performDelete("projects");

    const removedIds = harness.removeNote.mock.calls.map((c) => c[0]);
    expect(new Set(removedIds)).toEqual(
      new Set(["thr_a", "thr_b", "thr_c"]),
    );
    expect(removedIds).not.toContain("thr_x");
  });

  it("switches to the graph tab when the active note was archived", async () => {
    const notes = [
      makeNote({ id: "thr_a", folder: "topics", filename: "caching.md" }),
    ];
    const { result, harness } = renderActions(notes, "thr_a");

    await result.current.performDelete("topics/caching.md", "thr_a");

    expect(harness.setTab).toHaveBeenCalledWith("graph");
  });

  it("switches to the graph tab when the active note was inside an archived folder", async () => {
    const notes = [
      makeNote({ id: "thr_a", folder: "projects", filename: "alpha.md" }),
    ];
    const { result, harness } = renderActions(notes, "thr_a");

    await result.current.performDelete("projects");

    expect(harness.removeNote).toHaveBeenCalledWith("thr_a");
    expect(harness.setTab).toHaveBeenCalledWith("graph");
  });

  it("does not remove anything or archive when the user cancels the confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const notes = [
      makeNote({ id: "thr_a", folder: "topics", filename: "caching.md" }),
    ];
    const { result, harness } = renderActions(notes);

    await result.current.performDelete("topics/caching.md", "thr_a");

    expect(archiveMock).not.toHaveBeenCalled();
    expect(harness.removeNote).not.toHaveBeenCalled();
  });

  it("does not remove notes when the archive request fails", async () => {
    archiveMock.mockRejectedValueOnce(new Error("boom"));
    const notes = [
      makeNote({ id: "thr_a", folder: "topics", filename: "caching.md" }),
    ];
    const { result, harness } = renderActions(notes);

    await result.current.performDelete("topics/caching.md", "thr_a");

    expect(harness.removeNote).not.toHaveBeenCalled();
    expect(harness.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "sentinel" }),
    );
  });
});

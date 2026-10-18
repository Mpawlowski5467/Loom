import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture, Note, NoteId } from "../data/types";
import { useVaultContent } from "./useVaultContent";

const mocks = vi.hoisted(() => ({
  loadNoteSummaries: vi.fn(),
  getNote: vi.fn(),
  listCaptures: vi.fn(),
  subscribeEventDomains: vi.fn(),
  unsubscribe: vi.fn(),
  events: {
    domains: [] as string[],
    listener: null as ((type: string) => void) | null,
  },
}));

vi.mock("../api/notes", () => ({
  loadNoteSummaries: mocks.loadNoteSummaries,
  getNote: mocks.getNote,
  backendNoteToFrontend: vi.fn((record: unknown) => record),
  titleMapFromNotes: vi.fn(() => new Map()),
}));

vi.mock("../api/captures", () => ({
  listCaptures: mocks.listCaptures,
  backendCaptureToFrontend: vi.fn((record: unknown) => record),
}));

vi.mock("../api/events", () => ({
  subscribeEventDomains: mocks.subscribeEventDomains,
}));

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `Note ${id}`,
    type: "topic",
    folder: "topics",
    tags: [],
    body: "Body",
    links: [],
    history: [],
    created: "2026-07-14T12:00:00Z",
    modified: "2026-07-14T12:00:00Z",
    status: "active",
    source: "manual",
    ...overrides,
  };
}

function capture(id: string, overrides: Partial<Capture> = {}): Capture {
  return {
    id,
    title: `Capture ${id}`,
    folder: "captures",
    body: "Body",
    receivedAt: "2026-07-14T12:00:00Z",
    status: "pending",
    filePath: `/vault/threads/captures/${id}.md`,
    ...overrides,
  };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderContent(
  options: {
    enabled?: boolean;
    initialNotes?: Note[];
    initialCaptures?: Capture[];
  } = {},
) {
  const onLoadError = vi.fn();
  const hook = renderHook(() => {
    const [, setCurrentNoteId] = useState<NoteId | null>("missing-note");
    return useVaultContent({
      enabled: options.enabled ?? true,
      activeVault: "main",
      initialNotes: options.initialNotes ?? [],
      initialCaptures: options.initialCaptures ?? [],
      setCurrentNoteId,
      onLoadError,
    });
  });
  return { ...hook, onLoadError };
}

describe("useVaultContent", () => {
  it("does not let a pre-commit metadata response remove a confirmed new note", async () => {
    let resolveList!: (value: Note[]) => void;
    mocks.loadNoteSummaries.mockImplementationOnce(
      () =>
        new Promise<Note[]>((resolve) => {
          resolveList = resolve;
        }),
    );
    const { result } = renderContent();
    await advance(0);
    const confirmed = note("just-filed", { body: "Durable committed body" });
    act(() => result.current.appendNote(confirmed));
    await act(async () => resolveList([]));
    expect(result.current.noteById("just-filed")).toEqual(confirmed);
  });
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.loadNoteSummaries.mockReset().mockResolvedValue([]);
    mocks.getNote.mockReset();
    mocks.listCaptures.mockReset().mockResolvedValue([]);
    mocks.unsubscribe.mockReset();
    mocks.events.domains = [];
    mocks.events.listener = null;
    mocks.subscribeEventDomains
      .mockReset()
      .mockImplementation(
        (domains: string[], listener: (type: string) => void) => {
          mocks.events.domains = domains;
          mocks.events.listener = listener;
          return mocks.unsubscribe;
        },
      );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("hydrates both resources and preserves the public mutation helpers", async () => {
    const loadedNote = note("loaded", { links: ["linked"] });
    const loadedCapture = capture("loaded");
    mocks.loadNoteSummaries.mockResolvedValue([loadedNote]);
    mocks.listCaptures.mockResolvedValue([loadedCapture]);
    const { result, unmount } = renderContent();

    expect(result.current.notesLoaded).toBe(false);
    expect(result.current.capturesLoaded).toBe(false);
    await advance(0);

    expect(result.current.notes).toEqual([loadedNote]);
    expect(result.current.captures).toEqual([loadedCapture]);
    // No auto-selection from a refresh: nothing was selected before it.
    expect(result.current.selectedCaptureId).toBeNull();
    expect(result.current.notesLoaded).toBe(true);
    expect(result.current.capturesLoaded).toBe(true);
    expect(result.current.resolveWikilink("Note loaded|alias")).toBe("loaded");
    expect(result.current.backlinksFor("linked")).toEqual(["loaded"]);

    const added = note("added");
    act(() => result.current.appendNote(added));
    expect(result.current.noteById("added")).toEqual(added);
    act(() => result.current.updateNote({ ...added, title: "Updated" }));
    expect(result.current.noteById("added")?.title).toBe("Updated");
    act(() => result.current.removeNote("added"));
    expect(result.current.noteById("added")).toBeUndefined();

    act(() => result.current.setCaptureStatus("loaded", "processing"));
    expect(result.current.captures[0]?.status).toBe("processing");
    act(() => result.current.removeCapture("loaded"));
    expect(result.current.captures).toEqual([]);
    expect(result.current.selectedCaptureId).toBeNull();
    unmount();
  });

  it("clears a vanished selection to null on refresh instead of jumping to the first capture", async () => {
    const a = capture("a");
    const b = capture("b");
    mocks.listCaptures.mockResolvedValue([a, b]);
    const { result, unmount } = renderContent({ initialCaptures: [a, b] });
    await advance(0);

    // The initial preselection survives while its capture is still present.
    expect(result.current.selectedCaptureId).toBe("a");

    // Archiving the selected capture clears the selection…
    act(() => result.current.removeCapture("a"));
    expect(result.current.selectedCaptureId).toBeNull();

    // …and the refresh that confirms its disappearance must NOT re-select the
    // new first capture (which would fire an unprompted preview).
    mocks.listCaptures.mockResolvedValue([b]);
    act(() => mocks.events.listener?.("capture-changed"));
    await advance(650);

    expect(result.current.captures).toEqual([b]);
    expect(result.current.selectedCaptureId).toBeNull();
    unmount();
  });

  it("replaces a cached body when content version changes without a timestamp change", async () => {
    const old = note("same", { body: "old", contentVersion: "sha256:old" });
    mocks.loadNoteSummaries
      .mockResolvedValueOnce([old])
      .mockResolvedValueOnce([
        note("same", { body: "new", contentVersion: "sha256:new" }),
      ]);
    const { result, unmount } = renderContent();
    await advance(0);
    act(() => mocks.events.listener?.("note-changed"));
    await advance(650);
    expect(result.current.notes[0]?.body).toBe("new");
    unmount();
  });

  it("routes each typed event to only its owning resource", async () => {
    const { unmount } = renderContent();
    await advance(0);
    mocks.loadNoteSummaries.mockClear();
    mocks.listCaptures.mockClear();

    expect(mocks.events.domains).toEqual(["notes", "captures", "vault"]);

    act(() => mocks.events.listener?.("capture-job-changed"));
    await advance(700);
    expect(mocks.loadNoteSummaries).not.toHaveBeenCalled();
    expect(mocks.listCaptures).not.toHaveBeenCalled();

    act(() => mocks.events.listener?.("capture-changed"));
    await advance(650);
    expect(mocks.listCaptures).toHaveBeenCalledTimes(1);
    expect(mocks.loadNoteSummaries).not.toHaveBeenCalled();
    mocks.listCaptures.mockClear();

    act(() => mocks.events.listener?.("note-changed"));
    await advance(650);
    expect(mocks.loadNoteSummaries).toHaveBeenCalledTimes(1);
    expect(mocks.listCaptures).not.toHaveBeenCalled();
    mocks.loadNoteSummaries.mockClear();

    act(() => mocks.events.listener?.("vault-changed"));
    await advance(650);
    expect(mocks.loadNoteSummaries).toHaveBeenCalledTimes(1);
    expect(mocks.listCaptures).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("coalesces typed events with the watcher vault follow-up", async () => {
    const { unmount } = renderContent();
    await advance(0);
    mocks.loadNoteSummaries.mockClear();
    mocks.listCaptures.mockClear();

    act(() => {
      mocks.events.listener?.("capture-changed");
      mocks.events.listener?.("note-changed");
    });
    await advance(500);
    act(() => mocks.events.listener?.("vault-changed"));
    await advance(150);

    expect(mocks.loadNoteSummaries).toHaveBeenCalledTimes(1);
    expect(mocks.listCaptures).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("stays loaded and unsubscribed while live vault access is disabled", () => {
    const initialNote = note("demo");
    const initialCapture = capture("demo");
    const { result, unmount } = renderContent({
      enabled: false,
      initialNotes: [initialNote],
      initialCaptures: [initialCapture],
    });

    expect(result.current.notes).toEqual([initialNote]);
    expect(result.current.captures).toEqual([initialCapture]);
    expect(result.current.notesLoaded).toBe(true);
    expect(result.current.capturesLoaded).toBe(true);
    expect(mocks.loadNoteSummaries).not.toHaveBeenCalled();
    expect(mocks.listCaptures).not.toHaveBeenCalled();
    expect(mocks.subscribeEventDomains).not.toHaveBeenCalled();
    unmount();
  });

  it("surfaces a failed notes fetch as notesError and clears it on recovery", async () => {
    mocks.loadNoteSummaries.mockRejectedValueOnce(new Error("backend down"));
    const { result, unmount, onLoadError } = renderContent();

    await advance(0);

    // Loaded-but-errored: distinguishable from a genuinely empty vault.
    expect(result.current.notesLoaded).toBe(true);
    expect(result.current.notesError).toBe("backend down");
    expect(result.current.notes).toEqual([]);
    expect(onLoadError).toHaveBeenCalledWith("notes", "backend down");

    const recoveredNote = note("recovered");
    mocks.loadNoteSummaries.mockResolvedValue([recoveredNote]);
    act(() => mocks.events.listener?.("note-changed"));
    await advance(650);

    expect(result.current.notesError).toBeNull();
    expect(result.current.notes).toEqual([recoveredNote]);
    unmount();
  });

  it("keeps prior notes visible when a refresh fails", async () => {
    const loadedNote = note("loaded");
    mocks.loadNoteSummaries.mockResolvedValue([loadedNote]);
    const { result, unmount } = renderContent();
    await advance(0);
    expect(result.current.notes).toEqual([loadedNote]);

    mocks.loadNoteSummaries.mockRejectedValue(new Error("backend down"));
    act(() => mocks.events.listener?.("note-changed"));
    await advance(650);

    // The error is recorded but the stale notes are not discarded.
    expect(result.current.notesError).toBe("backend down");
    expect(result.current.notes).toEqual([loadedNote]);
    unmount();
  });

  it("loads only the selected body and reuses it until its version changes", async () => {
    const summary = note("a", { body: "", bodyLoaded: false });
    mocks.loadNoteSummaries.mockResolvedValue([
      summary,
      note("b", { body: "", bodyLoaded: false }),
    ]);
    mocks.getNote.mockResolvedValue(
      note("a", { body: "Full body", bodyLoaded: true }),
    );
    const onLoadError = vi.fn();
    const { result } = renderHook(() => {
      const [currentNoteId, setCurrentNoteId] = useState<NoteId | null>("a");
      return useVaultContent({
        enabled: true,
        activeVault: "main",
        currentNoteId,
        initialNotes: [],
        initialCaptures: [],
        setCurrentNoteId,
        onLoadError,
      });
    });
    await advance(0);
    expect(mocks.getNote).toHaveBeenCalledTimes(1);
    expect(mocks.getNote.mock.calls[0]?.[0]).toBe("a");
    expect(result.current.noteById("a")?.body).toBe("Full body");
    act(() => mocks.events.listener?.("note-changed"));
    await advance(650);
    expect(mocks.getNote).toHaveBeenCalledTimes(1);
    expect(result.current.noteById("a")?.body).toBe("Full body");
    mocks.loadNoteSummaries.mockResolvedValue([
      { ...summary, modified: "new-version" },
    ]);
    mocks.getNote.mockResolvedValue(
      note("a", { body: "Changed", bodyLoaded: true, modified: "new-version" }),
    );
    act(() => mocks.events.listener?.("note-changed"));
    await advance(650);
    expect(mocks.getNote).toHaveBeenCalledTimes(2);
    expect(result.current.noteById("a")?.body).toBe("Changed");
  });

  it("hides prior vault content immediately and ignores a late body response", async () => {
    let resolveBody: (value: Note) => void = () => {};
    mocks.loadNoteSummaries.mockResolvedValue([
      note("same", { body: "", bodyLoaded: false }),
    ]);
    mocks.getNote.mockImplementation(
      () =>
        new Promise<Note>((resolve) => {
          resolveBody = resolve;
        }),
    );
    const onLoadError = vi.fn();
    const { result, rerender } = renderHook(
      ({ vault }) => {
        const [currentNoteId, setCurrentNoteId] = useState<NoteId | null>(
          "same",
        );
        return useVaultContent({
          enabled: true,
          activeVault: vault,
          currentNoteId,
          initialNotes: [],
          initialCaptures: [],
          setCurrentNoteId,
          onLoadError,
        });
      },
      { initialProps: { vault: "one" } },
    );
    await advance(0);
    rerender({ vault: "two" });
    expect(result.current.notes).toEqual([]);
    expect(result.current.notesLoaded).toBe(false);
    mocks.loadNoteSummaries.mockResolvedValue([]);
    await act(async () =>
      resolveBody(note("same", { body: "Private old vault body" })),
    );
    await advance(0);
    expect(result.current.notes).toEqual([]);
  });
});

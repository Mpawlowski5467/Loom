import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture, Note, NoteId } from "../data/types";
import { useVaultContent } from "./useVaultContent";

const mocks = vi.hoisted(() => ({
  loadAllNotes: vi.fn(),
  listCaptures: vi.fn(),
  subscribeEventDomains: vi.fn(),
  unsubscribe: vi.fn(),
  events: {
    domains: [] as string[],
    listener: null as ((type: string) => void) | null,
  },
}));

vi.mock("../api/notes", () => ({
  loadAllNotes: mocks.loadAllNotes,
  backendNotesToFrontend: vi.fn((records: unknown[]) => records),
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
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.loadAllNotes.mockReset().mockResolvedValue([]);
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
    mocks.loadAllNotes.mockResolvedValue([loadedNote]);
    mocks.listCaptures.mockResolvedValue([loadedCapture]);
    const { result, unmount } = renderContent();

    expect(result.current.notesLoaded).toBe(false);
    expect(result.current.capturesLoaded).toBe(false);
    await advance(0);

    expect(result.current.notes).toEqual([loadedNote]);
    expect(result.current.captures).toEqual([loadedCapture]);
    expect(result.current.selectedCaptureId).toBe("loaded");
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

  it("routes each typed event to only its owning resource", async () => {
    const { unmount } = renderContent();
    await advance(0);
    mocks.loadAllNotes.mockClear();
    mocks.listCaptures.mockClear();

    expect(mocks.events.domains).toEqual(["notes", "captures", "vault"]);

    act(() => mocks.events.listener?.("capture-job-changed"));
    await advance(700);
    expect(mocks.loadAllNotes).not.toHaveBeenCalled();
    expect(mocks.listCaptures).not.toHaveBeenCalled();

    act(() => mocks.events.listener?.("capture-changed"));
    await advance(650);
    expect(mocks.listCaptures).toHaveBeenCalledTimes(1);
    expect(mocks.loadAllNotes).not.toHaveBeenCalled();
    mocks.listCaptures.mockClear();

    act(() => mocks.events.listener?.("note-changed"));
    await advance(650);
    expect(mocks.loadAllNotes).toHaveBeenCalledTimes(1);
    expect(mocks.listCaptures).not.toHaveBeenCalled();
    mocks.loadAllNotes.mockClear();

    act(() => mocks.events.listener?.("vault-changed"));
    await advance(650);
    expect(mocks.loadAllNotes).toHaveBeenCalledTimes(1);
    expect(mocks.listCaptures).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("coalesces typed events with the watcher vault follow-up", async () => {
    const { unmount } = renderContent();
    await advance(0);
    mocks.loadAllNotes.mockClear();
    mocks.listCaptures.mockClear();

    act(() => {
      mocks.events.listener?.("capture-changed");
      mocks.events.listener?.("note-changed");
    });
    await advance(500);
    act(() => mocks.events.listener?.("vault-changed"));
    await advance(150);

    expect(mocks.loadAllNotes).toHaveBeenCalledTimes(1);
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
    expect(mocks.loadAllNotes).not.toHaveBeenCalled();
    expect(mocks.listCaptures).not.toHaveBeenCalled();
    expect(mocks.subscribeEventDomains).not.toHaveBeenCalled();
    unmount();
  });
});

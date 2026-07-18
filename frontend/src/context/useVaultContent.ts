import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { backendCaptureToFrontend, listCaptures } from "../api/captures";
import { subscribeEventDomains } from "../api/events";
import type { LoomEventType } from "../api/events";
import { backendNotesToFrontend, loadAllNotes } from "../api/notes";
import type { Capture, CaptureStatus, Note, NoteId } from "../data/types";

const CONTENT_EVENT_DEBOUNCE_MS = 650;

type ContentDomain = "notes" | "captures";

interface UseVaultContentOptions {
  enabled: boolean;
  activeVault?: string;
  initialNotes: Note[];
  initialCaptures: Capture[];
  setCurrentNoteId: Dispatch<SetStateAction<NoteId | null>>;
  onLoadError: (domain: ContentDomain, message: string) => void;
}

export interface VaultContentState {
  notes: Note[];
  notesLoaded: boolean;
  notesError: string | null;
  wikilinkMap: Map<string, NoteId>;
  resolveWikilink: (raw: string) => NoteId | undefined;
  noteById: (id: string) => Note | undefined;
  backlinksFor: (id: string) => string[];
  appendNote: (note: Note) => void;
  updateNote: (note: Note) => void;
  removeNote: (id: string) => void;

  captures: Capture[];
  capturesLoaded: boolean;
  capturesError: string | null;
  selectedCaptureId: string | null;
  selectCapture: Dispatch<SetStateAction<string | null>>;
  setCaptureStatus: (id: string, status: CaptureStatus) => void;
  removeCapture: (id: string) => void;
}

/**
 * Owns live vault content and its typed refresh orchestration.
 *
 * Notes and captures have independent request/abort paths. Typed events reload
 * only their matching resource; the legacy broad vault signal reloads both so
 * filesystem edits from outside API routes still converge. A short leading
 * debounce spans the watcher's follow-up graph rebuild, coalescing a typed API
 * signal and its later ``vault-changed`` event into one fetch per domain.
 */
export function useVaultContent({
  enabled,
  activeVault,
  initialNotes,
  initialCaptures,
  setCurrentNoteId,
  onLoadError,
}: UseVaultContentOptions): VaultContentState {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [notesLoadedState, setNotesLoadedState] = useState(
    initialNotes.length > 0,
  );
  const [notesError, setNotesError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<Capture[]>(initialCaptures);
  const [capturesLoadedState, setCapturesLoadedState] = useState(
    initialCaptures.length > 0,
  );
  const [capturesError, setCapturesError] = useState<string | null>(null);
  const [selectedCaptureId, selectCapture] = useState<string | null>(
    initialCaptures[0]?.id ?? null,
  );
  const notesRequest = useRef<AbortController | null>(null);
  const capturesRequest = useRef<AbortController | null>(null);

  const refreshNotes = useCallback(async () => {
    notesRequest.current?.abort();
    const ctrl = new AbortController();
    notesRequest.current = ctrl;
    try {
      const records = await loadAllNotes(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const loaded = backendNotesToFrontend(records);
      setNotes(loaded);
      setNotesError(null);
      setCurrentNoteId((current) => {
        if (current && loaded.some((note) => note.id === current)) {
          return current;
        }
        return loaded[0]?.id ?? null;
      });
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      const message =
        err instanceof Error ? err.message : "Failed to load notes";
      setNotesError(message);
      onLoadError("notes", message);
    } finally {
      if (notesRequest.current === ctrl) {
        notesRequest.current = null;
        setNotesLoadedState(true);
      }
    }
  }, [onLoadError, setCurrentNoteId]);

  const refreshCaptures = useCallback(async () => {
    capturesRequest.current?.abort();
    const ctrl = new AbortController();
    capturesRequest.current = ctrl;
    try {
      const records = await listCaptures(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const loaded = records.map(backendCaptureToFrontend);
      setCaptures(loaded);
      setCapturesError(null);
      selectCapture((current) => {
        if (current && loaded.some((capture) => capture.id === current)) {
          return current;
        }
        // A vanished selection clears instead of jumping to the first
        // capture — auto-selecting here would fire an unprompted preview
        // right after the user archived/skipped the selected capture.
        return null;
      });
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      const message =
        err instanceof Error ? err.message : "Failed to load captures";
      setCapturesError(message);
      onLoadError("captures", message);
    } finally {
      if (capturesRequest.current === ctrl) {
        capturesRequest.current = null;
        setCapturesLoadedState(true);
      }
    }
  }, [onLoadError]);

  const abortLoads = useCallback(() => {
    notesRequest.current?.abort();
    capturesRequest.current?.abort();
    notesRequest.current = null;
    capturesRequest.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Defer the initial refresh out of the effect body. Besides satisfying the
    // hook rule, this lets a same-turn active-vault/config update supersede it
    // before any request leaves the browser.
    const timer = window.setTimeout(() => {
      void refreshNotes();
      void refreshCaptures();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      abortLoads();
    };
  }, [abortLoads, activeVault, enabled, refreshCaptures, refreshNotes]);

  useEffect(() => {
    if (!enabled) return;
    let notesTimer: ReturnType<typeof setTimeout> | undefined;
    let capturesTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNotes = () => {
      if (notesTimer) return;
      notesTimer = setTimeout(() => {
        notesTimer = undefined;
        void refreshNotes();
      }, CONTENT_EVENT_DEBOUNCE_MS);
    };
    const scheduleCaptures = () => {
      if (capturesTimer) return;
      capturesTimer = setTimeout(() => {
        capturesTimer = undefined;
        void refreshCaptures();
      }, CONTENT_EVENT_DEBOUNCE_MS);
    };
    const onEvent = (type: LoomEventType) => {
      if (type === "note-changed") scheduleNotes();
      if (type === "capture-changed") scheduleCaptures();
      if (type === "vault-changed") {
        scheduleNotes();
        scheduleCaptures();
      }
    };

    const unsubscribe = subscribeEventDomains(
      ["notes", "captures", "vault"],
      onEvent,
    );
    return () => {
      if (notesTimer) clearTimeout(notesTimer);
      if (capturesTimer) clearTimeout(capturesTimer);
      unsubscribe();
    };
  }, [enabled, refreshCaptures, refreshNotes]);

  const appendNote = useCallback((note: Note) => {
    setNotes((current) =>
      current.some((item) => item.id === note.id)
        ? current
        : [...current, note],
    );
  }, []);
  const updateNote = useCallback((note: Note) => {
    setNotes((current) => {
      const index = current.findIndex((item) => item.id === note.id);
      if (index === -1) return [...current, note];
      const next = current.slice();
      next[index] = note;
      return next;
    });
  }, []);
  const removeNote = useCallback((id: string) => {
    setNotes((current) => current.filter((note) => note.id !== id));
  }, []);

  const wikilinkMap = useMemo(() => {
    const map = new Map<string, NoteId>();
    for (const note of notes) map.set(note.title.toLowerCase(), note.id);
    return map;
  }, [notes]);
  const resolveWikilink = useCallback(
    (raw: string): NoteId | undefined =>
      wikilinkMap.get(raw.split("|")[0]!.trim().toLowerCase()),
    [wikilinkMap],
  );
  const noteById = useCallback(
    (id: string): Note | undefined => notes.find((note) => note.id === id),
    [notes],
  );
  const backlinksFor = useCallback(
    (id: string): string[] =>
      notes.filter((note) => note.links.includes(id)).map((note) => note.id),
    [notes],
  );

  const setCaptureStatus = useCallback((id: string, status: CaptureStatus) => {
    setCaptures((current) =>
      current.map((capture) =>
        capture.id === id ? { ...capture, status } : capture,
      ),
    );
  }, []);
  const removeCapture = useCallback((id: string) => {
    setCaptures((current) => current.filter((capture) => capture.id !== id));
    selectCapture((current) => (current === id ? null : current));
  }, []);

  return {
    notes,
    notesLoaded: enabled ? notesLoadedState : true,
    notesError,
    wikilinkMap,
    resolveWikilink,
    noteById,
    backlinksFor,
    appendNote,
    updateNote,
    removeNote,
    captures,
    capturesLoaded: enabled ? capturesLoadedState : true,
    capturesError,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,
    removeCapture,
  };
}

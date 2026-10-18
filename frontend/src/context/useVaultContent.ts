import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { backendCaptureToFrontend, listCaptures } from "../api/captures";
import { subscribeEventDomains } from "../api/events";
import type { LoomEventType } from "../api/events";
import {
  backendNoteToFrontend,
  getNote,
  loadNoteSummaries,
  titleMapFromNotes,
} from "../api/notes";
import type { Capture, CaptureStatus, Note, NoteId } from "../data/types";
import { buildWikilinkMap, linkTarget } from "../data/wikilinks";

const CONTENT_EVENT_DEBOUNCE_MS = 650;
const EMPTY_NOTES: Note[] = [];
const EMPTY_CAPTURES: Capture[] = [];

type ContentDomain = "notes" | "captures";

interface UseVaultContentOptions {
  enabled: boolean;
  activeVault?: string;
  currentNoteId?: NoteId | null;
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
  reloadNoteBody: (id: string) => Promise<void>;

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
  currentNoteId,
  initialNotes,
  initialCaptures,
  setCurrentNoteId,
  onLoadError,
}: UseVaultContentOptions): VaultContentState {
  const [notesState, setNotes] = useState<Note[]>(initialNotes);
  const [loadedVault, setLoadedVault] = useState(activeVault);
  const sameVault = !enabled || loadedVault === activeVault;
  const notes = sameVault ? notesState : EMPTY_NOTES;
  const [notesLoadedState, setNotesLoadedState] = useState(
    initialNotes.length > 0,
  );
  const [notesError, setNotesError] = useState<string | null>(null);
  const [capturesState, setCaptures] = useState<Capture[]>(initialCaptures);
  const captures = sameVault ? capturesState : EMPTY_CAPTURES;
  const [capturesLoadedState, setCapturesLoadedState] = useState(
    initialCaptures.length > 0,
  );
  const [capturesError, setCapturesError] = useState<string | null>(null);
  const [selectedCaptureId, selectCapture] = useState<string | null>(
    initialCaptures[0]?.id ?? null,
  );
  const notesRequest = useRef<AbortController | null>(null);
  const capturesRequest = useRef<AbortController | null>(null);
  const boundVault = useRef(activeVault);

  const refreshNotes = useCallback(async () => {
    notesRequest.current?.abort();
    const ctrl = new AbortController();
    notesRequest.current = ctrl;
    try {
      const loaded = await loadNoteSummaries(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setNotes((current) => {
        const previous = new Map(current.map((note) => [note.id, note]));
        return loaded.map((note) => {
          const old = previous.get(note.id);
          return old &&
            old.modified === note.modified &&
            old.contentVersion === note.contentVersion &&
            old.bodyLoaded !== false
            ? { ...note, body: old.body, bodyLoaded: true }
            : note;
        });
      });
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
      if (boundVault.current !== activeVault) {
        boundVault.current = activeVault;
        setLoadedVault(activeVault);
        setNotes([]);
        setCaptures([]);
        setNotesLoadedState(false);
        setCapturesLoadedState(false);
      }
      void refreshNotes();
      void refreshCaptures();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      abortLoads();
    };
  }, [abortLoads, activeVault, enabled, refreshCaptures, refreshNotes]);

  const selected = notes.find((note) => note.id === currentNoteId);
  const selectedModified = selected?.modified;
  const selectedContentVersion = selected?.contentVersion;
  const needsBody = selected?.bodyLoaded === false && !selected.bodyError;
  useEffect(() => {
    if (!enabled || !currentNoteId || !needsBody) return;
    const controller = new AbortController();
    const vault = activeVault;
    void getNote(currentNoteId, controller.signal)
      .then((record) => {
        if (controller.signal.aborted || boundVault.current !== vault) return;
        setNotes((current) => {
          const complete = backendNoteToFrontend(
            record,
            titleMapFromNotes(current),
          );
          return current.map((note) =>
            note.id === record.id
              ? {
                  ...complete,
                  links: [...new Set([...note.links, ...complete.links])],
                }
              : note,
          );
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : "Could not load note";
        setNotes((current) =>
          current.map((note) =>
            note.id === currentNoteId ? { ...note, bodyError: message } : note,
          ),
        );
        onLoadError("notes", message);
      });
    return () => controller.abort();
  }, [
    activeVault,
    currentNoteId,
    enabled,
    needsBody,
    onLoadError,
    selectedModified,
    selectedContentVersion,
  ]);

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
    // A list fetched before this confirmed write cannot replace its result.
    notesRequest.current?.abort();
    setNotes((current) =>
      current.some((item) => item.id === note.id)
        ? current
        : [...current, note],
    );
  }, []);
  const updateNote = useCallback((note: Note) => {
    notesRequest.current?.abort();
    setNotes((current) => {
      const index = current.findIndex((item) => item.id === note.id);
      if (index === -1) return [...current, note];
      const next = current.slice();
      next[index] = note;
      return next;
    });
  }, []);
  const removeNote = useCallback((id: string) => {
    notesRequest.current?.abort();
    setNotes((current) => current.filter((note) => note.id !== id));
  }, []);

  const reloadNoteBody = useCallback(async (id: string) => {
    const vault = boundVault.current;
    const record = await getNote(id);
    if (boundVault.current !== vault) return;
    setNotes((current) => {
      const complete = backendNoteToFrontend(
        record,
        titleMapFromNotes(current),
      );
      return current.map((note) =>
        note.id === id
          ? {
              ...complete,
              links: [...new Set([...note.links, ...complete.links])],
            }
          : note,
      );
    });
  }, []);

  const wikilinkMap = useMemo(() => buildWikilinkMap(notes), [notes]);
  const resolveWikilink = useCallback(
    (raw: string): NoteId | undefined => wikilinkMap.get(linkTarget(raw)),
    [wikilinkMap],
  );
  const notesById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const noteById = useCallback((id: string) => notesById.get(id), [notesById]);
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
    notesLoaded: enabled ? sameVault && notesLoadedState : true,
    notesError,
    wikilinkMap,
    resolveWikilink,
    noteById,
    backlinksFor,
    appendNote,
    updateNote,
    removeNote,
    reloadNoteBody,
    captures,
    capturesLoaded: enabled ? sameVault && capturesLoadedState : true,
    capturesError,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,
    removeCapture,
  };
}

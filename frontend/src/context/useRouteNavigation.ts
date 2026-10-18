import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  TAB_PATHS,
  noteHref,
  noteIdHref,
  parseRoute,
  resolveRouteNote,
  settingsPath,
  type RouteState,
} from "../app/routes";
import type { Note, NoteId, SettingsSection, Tab } from "../data/types";

/**
 * Navigation derived from the URL. Split in two because the vault content
 * hook sits between them: it needs the note to load (`lastNoteId`) before
 * the notes exist, and the note lookup needs the notes it loads.
 */
export function useRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(
    () => parseRoute(location.pathname, location.search),
    [location.pathname, location.search],
  );
  // The note most recently shown on /notes — what "Notes" returns to, and
  // what the vault hook keeps loaded. The vault hook may also set it (to the
  // first note) when nothing was chosen yet.
  const [lastNoteId, setLastNoteId] = useState<NoteId | null>(route.noteId);
  const notesRef = useRef<readonly Note[]>([]);
  // Latest values for the stable callbacks below.
  const lastNoteIdRef = useRef(lastNoteId);
  const routeRef = useRef<RouteState>(route);
  useEffect(() => {
    lastNoteIdRef.current = lastNoteId;
    routeRef.current = route;
  }, [lastNoteId, route]);

  const hrefForNote = useCallback((id: NoteId, heading = "") => {
    const note = notesRef.current.find((n) => n.id === id);
    return note ? noteHref(note, heading) : noteIdHref(id, heading);
  }, []);

  const setTab = useCallback(
    (tab: Tab) => {
      if (tab === "notes") {
        navigate(
          lastNoteIdRef.current ? hrefForNote(lastNoteIdRef.current) : "/notes",
        );
      } else if (tab === "settings") {
        navigate(settingsPath(routeRef.current.settingsSection));
      } else {
        navigate(TAB_PATHS[tab]);
      }
    },
    [hrefForNote, navigate],
  );

  const setSettingsSection = useCallback(
    (section: SettingsSection) => navigate(settingsPath(section)),
    [navigate],
  );

  const openNote = useCallback(
    (id: NoteId, heading = "") => {
      setLastNoteId(id);
      navigate(hrefForNote(id, heading));
    },
    [hrefForNote, navigate],
  );

  return {
    route,
    location,
    navigate,
    lastNoteId,
    setLastNoteId,
    notesRef,
    setTab,
    setSettingsSection,
    openNote,
  };
}

type RouteApi = ReturnType<typeof useRoute>;

/**
 * Resolve the route's note against the loaded notes, remember it, and
 * rewrite `/notes` and `/notes?id=` to the note's canonical path.
 */
export function useNoteRouting(
  api: RouteApi,
  notes: readonly Note[],
  notesLoaded: boolean,
): NoteId | null {
  const { route, location, navigate, lastNoteId, setLastNoteId, notesRef } =
    api;

  useEffect(() => {
    notesRef.current = notes;
  }, [notes, notesRef]);

  const routeNoteId = useMemo(
    () => resolveRouteNote(route, notes),
    [route, notes],
  );

  useEffect(() => {
    if (routeNoteId && routeNoteId !== lastNoteId) setLastNoteId(routeNoteId);
  }, [routeNoteId, lastNoteId, setLastNoteId]);

  // Bare /notes reopens the last note, else the most recently modified one.
  // An explicit path that matches no note shows "not found" rather than
  // silently opening some other note.
  const fallbackNoteId = useMemo(() => {
    let latest: Note | undefined;
    for (const n of notes)
      if (!latest || n.modified > latest.modified) latest = n;
    return latest?.id ?? null;
  }, [notes]);
  const currentNoteId =
    route.tab !== "notes"
      ? lastNoteId
      : route.notePath
        ? routeNoteId
        : (routeNoteId ?? lastNoteId ?? fallbackNoteId);

  useEffect(() => {
    if (route.tab !== "notes" || route.notePath || !notesLoaded) return;
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note) return;
    const href = noteHref(note, route.heading);
    // Keep unrelated query flags (demo, theme) when canonicalising.
    const params = new URLSearchParams(location.search);
    params.delete("id");
    params.delete("heading");
    const extra = params.toString();
    const target = extra
      ? `${href}${href.includes("?") ? "&" : "?"}${extra}`
      : href;
    navigate(target, { replace: true });
  }, [route, notes, notesLoaded, currentNoteId, location.search, navigate]);

  return currentNoteId;
}

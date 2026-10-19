import type { Note, NoteId, SettingsSection, Tab } from "../data/types";

/**
 * URL model. Routes:
 *   /graph · /notes/<folder>/<slug> · /board · /inbox · /threads/:id? ·
 *   /settings/:section?
 * The URL is the source of truth for navigation; AppContext derives its
 * `tab` / `currentNoteId` / `settingsSection` from it.
 */

export const TAB_PATHS: Record<Exclude<Tab, "notes" | "settings">, string> = {
  graph: "/graph",
  board: "/board",
  inbox: "/inbox",
  threads: "/threads",
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  "general",
  "appearance",
  "agents",
  "models",
  "privacy",
  "integrations",
  "vault",
];

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "appearance";

/** Section ids from before the settings nav was regrouped. */
const LEGACY_SETTINGS: Record<string, SettingsSection> = {
  providers: "models",
  hardware: "models",
  connections: "integrations",
  policy: "privacy",
  archived: "vault",
  danger: "vault",
  about: "general",
};

export function settingsSectionFrom(
  value: string | undefined,
): SettingsSection {
  if (!value) return DEFAULT_SETTINGS_SECTION;
  if ((SETTINGS_SECTIONS as readonly string[]).includes(value))
    return value as SettingsSection;
  return LEGACY_SETTINGS[value] ?? DEFAULT_SETTINGS_SECTION;
}

export function settingsPath(section: SettingsSection): string {
  return `/settings/${section}`;
}

/** A note's URL path: its file path under threads/, without `.md`. */
export function notePathOf(
  note: Pick<Note, "id" | "folder" | "filename">,
): string {
  const slug = note.filename ? note.filename.replace(/\.md$/i, "") : note.id;
  return [note.folder, slug].filter(Boolean).join("/");
}

export function noteHref(
  note: Pick<Note, "id" | "folder" | "filename">,
  heading = "",
): string {
  const path = notePathOf(note).split("/").map(encodeURIComponent).join("/");
  return `/notes/${path}${heading ? `?heading=${encodeURIComponent(heading)}` : ""}`;
}

/** A Threads entry: a daily log date, `standup-<id>` or `council-<date>`. */
export function threadHref(id: string): string {
  return `${TAB_PATHS.threads}/${encodeURIComponent(id)}`;
}

/** Fallback when only an id is known (notes not loaded yet). */
export function noteIdHref(id: NoteId, heading = ""): string {
  const params = new URLSearchParams({ id });
  if (heading) params.set("heading", heading);
  return `/notes?${params.toString()}`;
}

export interface RouteState {
  tab: Tab;
  /** `/notes/<path>` → path (decoded), else null. */
  notePath: string | null;
  /** `/notes?id=` → id, else null. */
  noteId: NoteId | null;
  heading: string;
  settingsSection: SettingsSection;
  threadId: string | null;
}

export function parseRoute(pathname: string, search: string): RouteState {
  const params = new URLSearchParams(search);
  const parts = pathname.split("/").filter(Boolean);
  const [head = "", ...rest] = parts;
  const tab: Tab =
    head === "notes" ||
    head === "board" ||
    head === "inbox" ||
    head === "threads" ||
    head === "settings"
      ? head
      : "graph";
  return {
    tab,
    notePath:
      tab === "notes" && rest.length > 0
        ? rest.map((p) => decodeURIComponent(p)).join("/")
        : null,
    noteId: tab === "notes" ? params.get("id") : null,
    heading: params.get("heading") ?? "",
    settingsSection: settingsSectionFrom(
      tab === "settings" ? rest[0] : undefined,
    ),
    threadId: tab === "threads" && rest[0] ? decodeURIComponent(rest[0]) : null,
  };
}

/** Find the note a route points at, by path or by `?id=`. */
export function resolveRouteNote(
  route: RouteState,
  notes: readonly Note[],
): NoteId | null {
  if (route.notePath) {
    const byPath = notes.find((n) => notePathOf(n) === route.notePath);
    if (byPath) return byPath.id;
    return notes.some((n) => n.id === route.notePath) ? route.notePath : null;
  }
  if (route.noteId && notes.some((n) => n.id === route.noteId))
    return route.noteId;
  return null;
}

/**
 * Old `?view=<tab>&note=<id>&heading=` URLs (pre-router) → a new URL, or
 * null when the URL isn't a legacy one.
 */
export function legacyRedirect(search: string): string | null {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (!view) return null;
  // Keep unrelated flags such as ?demo=1 or ?theme=.
  const keep = new URLSearchParams(params);
  for (const k of ["view", "note", "heading"]) keep.delete(k);
  const suffix = keep.toString();
  const withQuery = (path: string, extra?: URLSearchParams) => {
    const q = new URLSearchParams(extra);
    for (const [k, v] of keep) q.set(k, v);
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  };
  switch (view) {
    case "thread": {
      const note = params.get("note");
      if (!note) return withQuery("/notes");
      const extra = new URLSearchParams({ id: note });
      const heading = params.get("heading");
      if (heading) extra.set("heading", heading);
      return withQuery("/notes", extra);
    }
    case "board":
    case "inbox":
      return withQuery(`/${view}`);
    case "settings":
      return withQuery(settingsPath(DEFAULT_SETTINGS_SECTION));
    default:
      return suffix ? `/graph?${suffix}` : "/graph";
  }
}

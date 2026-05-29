import { useEffect, useMemo, useState } from "react";
import type { Note, NodeType } from "../../../data/types";

export interface Section {
  folder: string;
  type: NodeType;
  notes: Note[];
}

/** A right-click menu OR an inline rename — never both at once. */
export type TreeInteraction =
  | { kind: "menu"; x: number; y: number; target: "file" | "folder"; path: string; noteId?: string }
  | { kind: "rename"; path: string; initial: string; draft: string; error: string | null }
  | null;

export const FOLDER_ORDER: { folder: string; type: NodeType }[] = [
  { folder: "daily", type: "daily" },
  { folder: "projects", type: "project" },
  { folder: "topics", type: "topic" },
  { folder: "people", type: "people" },
  { folder: "captures", type: "capture" },
  { folder: "reading", type: "custom" },
  { folder: "scratch", type: "custom" },
  { folder: "agents", type: "people" },
];

export const FOLDER_TYPE_BY_NAME = new Map(
  FOLDER_ORDER.map((f) => [f.folder, f.type] as const),
);

export const FOLDER_NAME_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export const SAFE_NAME_RE = /^[A-Za-z0-9_-]+$/;
export const RESERVED_FOLDERS = new Set([
  "daily",
  "projects",
  "topics",
  "people",
  "captures",
]);
export const DRAG_MIME = "application/x-loom-path";

const TREE_EXPANDED_KEY = "loom.treeExpanded";

function loadExpanded(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TREE_EXPANDED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export interface TreeExpanded {
  isExpanded: (folder: string) => boolean;
  toggle: (folder: string) => void;
}

/** Per-folder expand/collapse state, persisted to localStorage. Folders default
 * to open. */
export function useTreeExpanded(): TreeExpanded {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(loadExpanded);

  useEffect(() => {
    try {
      window.localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify(expanded));
    } catch {
      // ignore quota / serialization failures
    }
  }, [expanded]);

  const isExpanded = (folder: string) =>
    expanded[folder] !== undefined ? expanded[folder]! : true;

  return {
    isExpanded,
    toggle: (folder: string) =>
      setExpanded((prev) => ({ ...prev, [folder]: !isExpanded(folder) })),
  };
}

/** Build the ordered folder sections from the notes + custom folders, filtered
 * by the title query. */
export function useTreeSections(
  notes: Note[],
  extraFolders: string[],
  filterLower: string,
): Section[] {
  return useMemo<Section[]>(() => {
    const filtered = filterLower
      ? notes.filter((n) => n.title.toLowerCase().includes(filterLower))
      : notes;

    const byFolder = new Map<string, Note[]>();
    for (const n of filtered) {
      const arr = byFolder.get(n.folder) ?? [];
      arr.push(n);
      byFolder.set(n.folder, arr);
    }

    const seen = new Set<string>();
    const out: Section[] = [];

    for (const f of FOLDER_ORDER) {
      const arr = byFolder.get(f.folder);
      if (!arr || arr.length === 0) continue;
      seen.add(f.folder);
      out.push({
        folder: f.folder,
        type: f.type,
        notes: [...arr].sort((a, b) =>
          a.type === "daily"
            ? b.title.localeCompare(a.title)
            : a.title.localeCompare(b.title),
        ),
      });
    }

    for (const folder of extraFolders) {
      if (seen.has(folder)) continue;
      seen.add(folder);
      const arr = byFolder.get(folder) ?? [];
      if (filterLower && arr.length === 0) continue;
      const type: NodeType = FOLDER_TYPE_BY_NAME.get(folder) ?? "custom";
      out.push({
        folder,
        type,
        notes: [...arr].sort((a, b) => a.title.localeCompare(b.title)),
      });
    }

    return out;
  }, [notes, extraFolders, filterLower]);
}

/** Per-note connection counts (outgoing + incoming links). */
export function useLinkCount(notes: Note[]): Map<string, number> {
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      m.set(n.id, (m.get(n.id) ?? 0) + n.links.length);
      for (const l of n.links) m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [notes]);
}

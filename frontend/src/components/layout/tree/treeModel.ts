import { useEffect, useMemo, useState } from "react";
import type { Note, NodeType } from "../../../data/types";

export interface FolderTreeNode {
  /** Last path segment, e.g. ``loom-ui``. */
  name: string;
  /** Full folder path under ``threads/``, e.g. ``projects/loom-ui``. */
  path: string;
  folders: FolderTreeNode[];
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

interface MutableNode {
  name: string;
  path: string;
  folders: Map<string, MutableNode>;
  notes: Note[];
}

function emptyNode(name: string, path: string): MutableNode {
  return { name, path, folders: new Map(), notes: [] };
}

/** Walk (creating as needed) the folder chain for a path like
 * ``projects/loom-ui`` and return the deepest node. ``""`` returns the root. */
function ensurePath(root: MutableNode, folder: string): MutableNode {
  let cur = root;
  let prefix = "";
  for (const seg of folder.split("/")) {
    if (!seg) continue;
    prefix = prefix ? `${prefix}/${seg}` : seg;
    let next = cur.folders.get(seg);
    if (!next) {
      next = emptyNode(seg, prefix);
      cur.folders.set(seg, next);
    }
    cur = next;
  }
  return cur;
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) =>
    a.type === "daily"
      ? b.title.localeCompare(a.title)
      : a.title.localeCompare(b.title),
  );
}

/** Top-level folders follow FOLDER_ORDER; the rest fall back to alphabetical. */
function topLevelRank(folder: string): number {
  const idx = FOLDER_ORDER.findIndex((f) => f.folder === folder);
  return idx === -1 ? FOLDER_ORDER.length : idx;
}

/** Freeze the mutable tree into ordered ``FolderTreeNode``s. ``depth`` is the
 * depth of ``node`` itself: its top-level children (node at depth 0) order by
 * FOLDER_ORDER, everything deeper is alphabetical. Notes follow folders. */
function finalize(node: MutableNode, depth: number): FolderTreeNode {
  const folders = [...node.folders.values()]
    .map((child) => finalize(child, depth + 1))
    .sort((a, b) =>
      depth === 0
        ? topLevelRank(a.path) - topLevelRank(b.path) ||
          a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
  return {
    name: node.name,
    path: node.path,
    folders,
    notes: sortNotes(node.notes),
  };
}

/** Drop folders whose subtree holds no notes — used while filtering so empty
 * branches don't linger. */
function pruneEmpty(node: FolderTreeNode): FolderTreeNode | null {
  const folders = node.folders
    .map(pruneEmpty)
    .filter((n): n is FolderTreeNode => n !== null);
  if (folders.length === 0 && node.notes.length === 0) return null;
  return { ...node, folders };
}

/** Build the nested folder tree from the notes (+ user-created folders),
 * filtered by the title query. Folders nest by their ``/``-separated path;
 * root-level notes (``folder === ""``) are not shown. */
export function buildFolderTree(
  notes: Note[],
  extraFolders: string[],
  filterLower: string,
): FolderTreeNode[] {
  const filtered = filterLower
    ? notes.filter((n) => n.title.toLowerCase().includes(filterLower))
    : notes;

  const root = emptyNode("", "");
  for (const n of filtered) ensurePath(root, n.folder).notes.push(n);

  // Materialize user-created (possibly empty) folders, but not while filtering
  // — an empty folder can't match a title query.
  if (!filterLower) for (const f of extraFolders) ensurePath(root, f);

  const tree = finalize(root, 0).folders;
  if (!filterLower) return tree;
  return tree.map(pruneEmpty).filter((n): n is FolderTreeNode => n !== null);
}

/** Memoized wrapper around {@link buildFolderTree}. */
export function useFolderTree(
  notes: Note[],
  extraFolders: string[],
  filterLower: string,
): FolderTreeNode[] {
  return useMemo(
    () => buildFolderTree(notes, extraFolders, filterLower),
    [notes, extraFolders, filterLower],
  );
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

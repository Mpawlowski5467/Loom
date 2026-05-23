import { apiClient } from "./client";
import type { NodeType, Note } from "../data/types";

export interface NoteRecord {
  id: string;
  title: string;
  type: string;
  tags: string[];
  created: string;
  modified: string;
  author: string;
  source: string;
  links: string[];
  status: string;
  history: Array<{ action: string; by: string; at: string; reason?: string }>;
  file_path: string;
  body: string;
  wikilinks: string[];
}

export interface CreateNotePayload {
  title: string;
  type?: string;
  tags?: string[];
  folder?: string;
  content?: string;
}

export function createNote(payload: CreateNotePayload): Promise<NoteRecord> {
  return apiClient.post<NoteRecord>("/api/notes", payload);
}

export interface UpdateNotePayload {
  body?: string;
  tags?: string[];
  type?: string;
  title?: string;
}

export function updateNote(
  id: string,
  payload: UpdateNotePayload,
): Promise<NoteRecord> {
  return apiClient.put<NoteRecord>(`/api/notes/${id}`, payload);
}

export function archiveNote(
  id: string,
): Promise<{ status: string; path: string }> {
  return apiClient.delete<{ status: string; path: string }>(
    `/api/notes/${id}`,
  );
}

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  note_id?: string;
  note_type?: string;
  tag_count?: number;
  modified?: string;
  children: TreeNode[];
}

export function getTree(): Promise<TreeNode> {
  return apiClient.get<TreeNode>("/api/tree");
}

export function createFolder(path: string): Promise<TreeNode> {
  return apiClient.post<TreeNode>("/api/tree/folder", { path });
}

export function moveTreePath(from: string, to: string): Promise<TreeNode> {
  return apiClient.post<TreeNode>("/api/tree/move", { from, to });
}

export function renameTreePath(
  path: string,
  newName: string,
): Promise<TreeNode> {
  return apiClient.patch<TreeNode>("/api/tree/rename", {
    path,
    new_name: newName,
  });
}

export function archiveTreePath(
  path: string,
  hard = false,
): Promise<{ status: string; path: string }> {
  const qs = hard ? "?hard=true" : "";
  return apiClient.delete<{ status: string; path: string }>(
    `/api/tree/path/${path}${qs}`,
  );
}

function toKebab(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The path of a note relative to ``threads/`` — ``<folder>/<filename>``.
 * For seed notes without ``filename``, derives a kebab filename from
 * the title.
 */
export function notePathOf(note: {
  folder: string;
  filename?: string;
  title: string;
}): string {
  const file = note.filename ?? `${toKebab(note.title) || "note"}.md`;
  return note.folder ? `${note.folder}/${file}` : file;
}

const NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "project",
  "topic",
  "people",
  "daily",
  "capture",
  "custom",
]);

export function backendNoteToFrontend(record: NoteRecord): Note {
  const rawType = record.type === "person" ? "people" : record.type;
  const type: NodeType = NODE_TYPES.has(rawType as NodeType)
    ? (rawType as NodeType)
    : "custom";
  const parts = record.file_path.split("/threads/")[1]?.split("/") ?? [];
  const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  const filename = parts[parts.length - 1] ?? `${record.id}.md`;
  return {
    id: record.id,
    title: record.title,
    type,
    folder,
    filename,
    tags: record.tags,
    body: record.body,
    links: record.links,
    history: record.history.map((h) => ({
      action: h.action as Note["history"][number]["action"],
      by: h.by as Note["history"][number]["by"],
      at: h.at,
      reason: h.reason,
    })),
    created: record.created,
    modified: record.modified,
    status: record.status === "archived" ? "archived" : "active",
    source: record.source,
  };
}

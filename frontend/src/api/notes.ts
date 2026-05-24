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

export type NoteMetaRecord = Omit<NoteRecord, "body" | "wikilinks">;

export interface NoteListResponse {
  notes: NoteMetaRecord[];
  total: number;
  offset: number;
  limit: number;
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

export function listNoteRecords(
  offset = 0,
  limit = 200,
  signal?: AbortSignal,
): Promise<NoteListResponse> {
  return apiClient.get<NoteListResponse>(
    `/api/notes?offset=${offset}&limit=${limit}`,
    signal,
  );
}

export function getNote(id: string, signal?: AbortSignal): Promise<NoteRecord> {
  return apiClient.get<NoteRecord>(
    `/api/notes/${encodeURIComponent(id)}`,
    signal,
  );
}

export async function loadAllNotes(signal?: AbortSignal): Promise<NoteRecord[]> {
  const limit = 200;
  const records: NoteRecord[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await listNoteRecords(offset, limit, signal);
    total = page.total;
    const full = await Promise.all(
      page.notes.map((n) => getNote(n.id, signal)),
    );
    records.push(...full);
    offset += page.notes.length;
    if (page.notes.length === 0) break;
  }

  return records;
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

export function titleMapFromNotes(notes: Note[]): Map<string, string> {
  return new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
}

export function titleMapFromRecords(records: NoteRecord[]): Map<string, string> {
  return new Map(records.map((n) => [n.title.toLowerCase(), n.id]));
}

export function backendNoteToFrontend(
  record: NoteRecord,
  titleToId: Map<string, string> = new Map(),
): Note {
  const rawType = record.type === "person" ? "people" : record.type;
  const type: NodeType = NODE_TYPES.has(rawType as NodeType)
    ? (rawType as NodeType)
    : "custom";
  const parts = record.file_path.split("/threads/")[1]?.split("/") ?? [];
  const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  const filename = parts[parts.length - 1] ?? `${record.id}.md`;
  const links = resolveLinkIds(record, titleToId);
  return {
    id: record.id,
    title: record.title,
    type,
    folder,
    filename,
    tags: record.tags,
    body: record.body,
    links,
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

export function backendNotesToFrontend(records: NoteRecord[]): Note[] {
  const titleToId = titleMapFromRecords(records);
  return records.map((record) => backendNoteToFrontend(record, titleToId));
}

function resolveLinkIds(
  record: NoteRecord,
  titleToId: Map<string, string>,
): string[] {
  const ids = new Set<string>();

  for (const raw of record.links) {
    const mapped = titleToId.get(raw.toLowerCase());
    ids.add(mapped ?? raw);
  }

  for (const raw of record.wikilinks) {
    const target = raw.split("|")[0]!.trim().toLowerCase();
    const id = titleToId.get(target);
    if (id) ids.add(id);
  }

  ids.delete(record.id);
  return [...ids];
}

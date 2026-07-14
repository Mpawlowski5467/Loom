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

export interface BulkNotesResponse {
  notes: NoteRecord[];
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

/** Notes returned per bulk page. Comfortably under the backend read limit. */
const BULK_PAGE_SIZE = 500;

/**
 * Fetch a page of full notes (frontmatter + body) in a single request via the
 * bulk endpoint — no per-note round-trips.
 */
export function listNotesBulk(
  offset = 0,
  limit = BULK_PAGE_SIZE,
  signal?: AbortSignal,
): Promise<BulkNotesResponse> {
  return apiClient.get<BulkNotesResponse>(
    `/api/notes/bulk?offset=${offset}&limit=${limit}`,
    signal,
  );
}

/**
 * Load every note in the active vault by paging the bulk endpoint.
 *
 * This replaces the old N+1 (one ``getNote`` per note) that fired hundreds of
 * requests and tripped the backend's per-IP read limiter at a few hundred
 * notes — silently dropping notes past the cap. One request per
 * ``BULK_PAGE_SIZE`` notes stays well under the limit. An ``AbortError`` from a
 * cancelled load still propagates so an in-flight load can be cancelled.
 */
export async function loadAllNotes(
  signal?: AbortSignal,
): Promise<NoteRecord[]> {
  const records: NoteRecord[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await listNotesBulk(offset, BULK_PAGE_SIZE, signal);
    total = page.total;
    if (page.notes.length === 0) break;
    records.push(...page.notes);
    offset += page.notes.length;
  }

  return records;
}

export interface UpdateNotePayload {
  body?: string;
  tags?: string[];
  type?: string;
  title?: string;
  /**
   * The ``modified`` timestamp the client last saw. When set and stale (the
   * note changed underneath — agent edit, another tab), the backend rejects
   * the update with 409 instead of clobbering the other write.
   */
  base_modified?: string;
}

export function updateNote(
  id: string,
  payload: UpdateNotePayload,
): Promise<NoteRecord> {
  return apiClient.put<NoteRecord>(
    `/api/notes/${encodeURIComponent(id)}`,
    payload,
  );
}

export function archiveNote(
  id: string,
  baseModified?: string,
): Promise<{ status: string; path: string }> {
  const query = baseModified
    ? `?base_modified=${encodeURIComponent(baseModified)}`
    : "";
  return apiClient.delete<{ status: string; path: string }>(
    `/api/notes/${encodeURIComponent(id)}${query}`,
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
  // Encode each path segment (preserving the ``/`` separators) so a filename
  // containing ``#``, ``?``, or ``%`` — entirely possible for vault files
  // edited outside Loom — doesn't truncate or corrupt the request URL.
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return apiClient.delete<{ status: string; path: string }>(
    `/api/tree/path/${encoded}${qs}`,
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

export function titleMapFromRecords(
  records: NoteRecord[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of records) {
    const slug = n.file_path
      .split("/")
      .pop()
      ?.replace(/\.md$/i, "")
      .toLowerCase();
    if (slug && !map.has(slug)) map.set(slug, n.id);
    const title = n.title?.toLowerCase();
    if (title && !map.has(title)) map.set(title, n.id);
  }
  return map;
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
  const normalize = (raw: string) =>
    raw.split("|", 1)[0]!.split("#", 1)[0]!.trim().toLowerCase();

  for (const raw of record.links) {
    const id = titleToId.get(normalize(raw));
    if (id) ids.add(id);
  }

  for (const raw of record.wikilinks) {
    const id = titleToId.get(normalize(raw));
    if (id) ids.add(id);
  }

  ids.delete(record.id);
  return [...ids];
}

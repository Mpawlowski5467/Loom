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

/**
 * Run an async mapper over ``items`` with at most ``concurrency`` in flight at
 * once. Bounds the request fan-out so a large vault doesn't fire hundreds of
 * simultaneous ``getNote`` calls and trip the backend's per-IP rate limit.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await mapper(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const pool = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return results;
}

/** Max concurrent ``getNote`` requests during the initial vault load. */
const LOAD_CONCURRENCY = 8;

/**
 * Load every note in the active vault: page the metadata list, then fetch each
 * note's full body.
 *
 * The list endpoint returns metadata only, so this is necessarily an N+1. To
 * stay resilient at real-vault scale it (a) caps concurrent fetches so the load
 * doesn't trip the backend rate limit, and (b) uses settle-not-reject semantics
 * so a single failed note (429, corrupt frontmatter, locked file) is skipped
 * rather than zeroing out the entire result. An ``AbortError`` still propagates
 * so an in-flight load can be cancelled.
 */
export async function loadAllNotes(signal?: AbortSignal): Promise<NoteRecord[]> {
  const limit = 200;
  const records: NoteRecord[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await listNoteRecords(offset, limit, signal);
    total = page.total;
    if (page.notes.length === 0) break;

    const settled = await mapWithConcurrency(
      page.notes,
      LOAD_CONCURRENCY,
      (n) => getNote(n.id, signal),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        records.push(result.value);
      } else if ((result.reason as DOMException)?.name === "AbortError") {
        // The whole load was cancelled — stop and surface it to the caller.
        throw result.reason;
      }
      // Any other per-note failure is skipped: a bad note must not blank the
      // entire vault.
    }
    offset += page.notes.length;
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

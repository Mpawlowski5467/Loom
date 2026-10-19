import { apiClient } from "./client";
import type { NodeType, Note } from "../data/types";
import { buildWikilinkMap, linkTarget } from "../data/wikilinks";

export interface NoteRecord {
  id: string;
  title: string;
  type: string;
  tags: string[];
  created: string;
  modified: string;
  content_version?: string;
  author: string;
  source: string;
  links: string[];
  status: string;
  history: Array<{ action: string; by: string; at: string; reason?: string }>;
  file_path: string;
  body: string;
  wikilinks: string[];
  extra?: Record<string, unknown>;
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

/** Navigation never downloads every Markdown body. Graph edges include body links. */
export async function loadNoteSummaries(signal?: AbortSignal): Promise<Note[]> {
  const [records, graph] = await Promise.all([
    loadMetadata(signal),
    apiClient.get<{ edges: Array<{ source: string; target: string }> }>(
      "/api/graph",
      signal,
    ),
  ]);
  const edges = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const linked = edges.get(edge.source) ?? new Set<string>();
    linked.add(edge.target);
    edges.set(edge.source, linked);
  }
  const full = records.map((record) => ({
    ...record,
    body: "",
    wikilinks: [],
  }));
  return backendNotesToFrontend(full).map((note) => ({
    ...note,
    bodyLoaded: false,
    links: [...(edges.get(note.id) ?? note.links)],
  }));
}

async function loadMetadata(signal?: AbortSignal): Promise<NoteMetaRecord[]> {
  const records: NoteMetaRecord[] = [];
  let total = Infinity;
  while (records.length < total) {
    const page = await listNoteRecords(records.length, 200, signal);
    total = page.total;
    if (!page.notes.length) break;
    records.push(...page.notes);
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
  return buildWikilinkMap(notes);
}

export function titleMapFromRecords(
  records: NoteRecord[],
): Map<string, string> {
  return buildWikilinkMap(
    records.map((record) => backendNoteToFrontend(record)),
  );
}

export function backendNoteToFrontend(
  record: NoteRecord,
  titleToId: Map<string, string> = new Map(),
): Note {
  const rawType = record.type === "person" ? "people" : record.type;
  const type: NodeType = NODE_TYPES.has(rawType as NodeType)
    ? (rawType as NodeType)
    : "custom";
  const parts =
    record.file_path.replace(/\\/g, "/").split("/threads/")[1]?.split("/") ??
    [];
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
    bodyLoaded: true,
    aliases: Array.isArray(record.extra?.aliases)
      ? record.extra.aliases.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    reviewRequired: record.extra?.review_required === true,
    publication:
      typeof record.extra?.publication_state === "string"
        ? record.extra.publication_state
        : undefined,
    links,
    history: record.history.map((h) => ({
      action: h.action as Note["history"][number]["action"],
      by: h.by as Note["history"][number]["by"],
      at: h.at,
      reason: h.reason,
    })),
    created: record.created,
    modified: record.modified,
    contentVersion: record.content_version,
    status:
      record.status === "archived" || record.status === "superseded"
        ? record.status
        : "active",
    source: record.source,
    author: record.author,
    extra: record.extra ?? {},
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
  const normalize = linkTarget;

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

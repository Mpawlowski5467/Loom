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
}

export function updateNote(
  id: string,
  payload: UpdateNotePayload,
): Promise<NoteRecord> {
  return apiClient.put<NoteRecord>(`/api/notes/${id}`, payload);
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
  return {
    id: record.id,
    title: record.title,
    type,
    folder,
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

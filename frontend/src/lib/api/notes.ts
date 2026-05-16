import { request } from "./common";

export interface HistoryEntry {
  action: string;
  by: string;
  at: string;
  reason: string;
}

export interface Note {
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
  history: HistoryEntry[];
  body: string;
  wikilinks: string[];
  file_path: string;
}

export function fetchNote(id: string): Promise<Note> {
  return request<Note>(`/api/notes/${encodeURIComponent(id)}`);
}

export function updateNote(
  id: string,
  data: { body?: string; tags?: string[]; type?: string },
): Promise<Note> {
  return request<Note>(`/api/notes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function createNote(data: {
  title: string;
  type: string;
  tags: string[];
  folder?: string;
  content?: string;
}): Promise<Note> {
  return request<Note>("/api/notes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function archiveNote(id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

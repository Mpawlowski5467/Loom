const API_BASE = "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// -- Tree types ---------------------------------------------------------------

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  note_id: string;
  note_type: string;
  tag_count: number;
  modified: string;
  children: TreeNode[];
}

// -- Graph types --------------------------------------------------------------

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  tags: string[];
  link_count: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// -- Note types ---------------------------------------------------------------

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

// -- API calls ----------------------------------------------------------------

export function fetchTree(): Promise<TreeNode> {
  return request<TreeNode>("/api/tree");
}

export function fetchGraph(params?: {
  type?: string;
  tag?: string;
}): Promise<VaultGraph> {
  const query = new URLSearchParams();
  if (params?.type) query.set("type", params.type);
  if (params?.tag) query.set("tag", params.tag);
  const qs = query.toString();
  return request<VaultGraph>(`/api/graph${qs ? `?${qs}` : ""}`);
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

// -- Search types -------------------------------------------------------------

export interface SearchResult {
  id: string;
  title: string;
  type: string;
  tags: string[];
  snippet: string;
  score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export function searchNotes(q: string): Promise<SearchResponse> {
  return request<SearchResponse>(
    `/api/search?q=${encodeURIComponent(q)}`,
  );
}

export function archiveNote(id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

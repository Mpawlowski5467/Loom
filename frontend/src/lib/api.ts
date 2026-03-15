const API_BASE = "http://localhost:8000";

/** Error with structured detail from FastAPI responses. */
export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`API ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      // Use statusText as fallback
    }
    throw new ApiError(res.status, detail);
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

// -- Capture types ------------------------------------------------------------

export interface CaptureItem {
  id: string;
  title: string;
  type: string;
  tags: string[];
  created: string;
  modified: string;
  author: string;
  source: string;
  status: string;
  preview: string;
  file_path: string;
}

export function fetchCaptures(): Promise<CaptureItem[]> {
  return request<CaptureItem[]>("/api/captures");
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
  mode: "semantic" | "keyword";
}

export function searchNotes(
  q: string,
  params?: { type?: string; tags?: string; context?: string },
): Promise<SearchResponse> {
  const query = new URLSearchParams({ q });
  if (params?.type) query.set("type", params.type);
  if (params?.tags) query.set("tags", params.tags);
  if (params?.context) query.set("context", params.context);
  return request<SearchResponse>(`/api/search?${query.toString()}`);
}

// -- Index types --------------------------------------------------------------

export interface IndexStatus {
  ready: boolean;
  message: string;
}

export interface ReindexResult {
  chunks_indexed: number;
}

export function fetchIndexStatus(): Promise<IndexStatus> {
  return request<IndexStatus>("/api/index/status");
}

export function reindexVault(): Promise<ReindexResult> {
  return request<ReindexResult>("/api/index/reindex", { method: "POST" });
}

export function archiveNote(id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

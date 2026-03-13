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

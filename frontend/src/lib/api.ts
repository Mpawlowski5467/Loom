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

// -- API calls ----------------------------------------------------------------

export function fetchTree(): Promise<TreeNode> {
  return request<TreeNode>("/api/tree");
}

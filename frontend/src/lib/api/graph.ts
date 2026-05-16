import { API_BASE, ApiError, request } from "./common";

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
  updated_at?: string;
}

/** Result of a conditional graph fetch. */
export interface GraphFetchResult {
  /** Null if the server returned 304 Not Modified. */
  data: VaultGraph | null;
  /** ETag returned by the server, or null if absent. */
  etag: string | null;
}

export function fetchGraph(params?: { type?: string; tag?: string }): Promise<VaultGraph> {
  const query = new URLSearchParams();
  if (params?.type) query.set("type", params.type);
  if (params?.tag) query.set("tag", params.tag);
  const qs = query.toString();
  return request<VaultGraph>(`/api/graph${qs ? `?${qs}` : ""}`);
}

/**
 * Conditional graph fetch using If-None-Match.
 *
 * Returns `{ data: null, etag }` on 304 so the caller can skip re-rendering.
 * On 200, returns the parsed graph and the new ETag.
 */
export async function fetchGraphConditional(
  etag: string | null,
  params?: { type?: string; tag?: string },
): Promise<GraphFetchResult> {
  const query = new URLSearchParams();
  if (params?.type) query.set("type", params.type);
  if (params?.tag) query.set("tag", params.tag);
  const qs = query.toString();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetch(`${API_BASE}/api/graph${qs ? `?${qs}` : ""}`, { headers });

  if (res.status === 304) {
    return { data: null, etag: res.headers.get("ETag") ?? etag };
  }

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

  const data = (await res.json()) as VaultGraph;
  return { data, etag: res.headers.get("ETag") };
}

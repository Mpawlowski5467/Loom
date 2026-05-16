import { request } from "./common";

export interface SearchResult {
  id: string;
  title: string;
  type: string;
  tags: string[];
  snippet: string;
  score: number;
  heading: string;
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

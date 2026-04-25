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

export function fetchGraph(params?: { type?: string; tag?: string }): Promise<VaultGraph> {
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

// -- Agent types --------------------------------------------------------------

export interface AgentStatus {
  name: string;
  role: string;
  enabled: boolean;
  trust_level: string;
  action_count: number;
  last_action: string | null;
}

export interface ChangelogEntry {
  agent: string;
  date: string;
  content: string;
}

export interface RunResult {
  agent: string;
  result: Record<string, unknown>;
}

export function fetchAgents(): Promise<AgentStatus[]> {
  return request<AgentStatus[]>("/api/agents");
}

export function runAgent(name: string): Promise<RunResult> {
  return request<RunResult>(`/api/agents/${encodeURIComponent(name)}/run`, {
    method: "POST",
  });
}

export function fetchChangelog(agent: string, date?: string): Promise<ChangelogEntry> {
  const query = new URLSearchParams({ agent });
  if (date) query.set("date", date);
  return request<ChangelogEntry>(`/api/changelog?${query.toString()}`);
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

export interface ProcessResult {
  processed: boolean;
  note_id: string;
  note_title: string;
  note_type: string;
  target_path: string;
  error: string;
}

export interface ProcessAllResult {
  total: number;
  processed: number;
  results: ProcessResult[];
}

export function processCapture(capturePath: string): Promise<ProcessResult> {
  return request<ProcessResult>("/api/captures/process", {
    method: "POST",
    body: JSON.stringify({ capture_path: capturePath }),
  });
}

export function processAllCaptures(): Promise<ProcessAllResult> {
  return request<ProcessAllResult>("/api/captures/process-all", {
    method: "POST",
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

// -- Chat types ---------------------------------------------------------------

export interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
  agent: string;
}

export interface SendMessageResponse {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}

export interface ChatHistoryResponse {
  agent: string;
  messages: ChatMessage[];
}

export interface ChatSessionList {
  agent: string;
  sessions: string[];
}

export function sendChatMessage(
  message: string,
  agent: string = "_council",
): Promise<SendMessageResponse> {
  return request<SendMessageResponse>("/api/chat/send", {
    method: "POST",
    body: JSON.stringify({ message, agent }),
  });
}

export function fetchChatHistory(
  agent: string = "_council",
  limit: number = 20,
): Promise<ChatHistoryResponse> {
  const query = new URLSearchParams({ agent, limit: String(limit) });
  return request<ChatHistoryResponse>(`/api/chat/history?${query.toString()}`);
}

export function fetchChatHistoryByDate(
  dateStr: string,
  agent: string = "_council",
): Promise<ChatHistoryResponse> {
  const query = new URLSearchParams({ agent });
  return request<ChatHistoryResponse>(
    `/api/chat/history/${encodeURIComponent(dateStr)}?${query.toString()}`,
  );
}

export function fetchChatSessions(agent: string = "_council"): Promise<ChatSessionList> {
  return request<ChatSessionList>(`/api/chat/sessions?agent=${encodeURIComponent(agent)}`);
}

// -- Settings types -----------------------------------------------------------

export interface ProviderInput {
  name: string;
  type: "cloud" | "local";
  apiKey: string;
  host: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  isDefault: boolean;
}

export interface SaveProvidersRequest {
  providers: Array<{
    name: string;
    type: string;
    api_key: string;
    host: string;
    base_url: string;
    chat_model: string;
    embed_model: string;
    is_default: boolean;
  }>;
}

export interface SaveProvidersResponse {
  saved: number;
  default_chat_provider: string | null;
  default_embed_provider: string | null;
}

export interface ProviderOutput {
  name: string;
  type: "cloud" | "local";
  apiKey: string; // masked, e.g. "…1234"
  apiKeySet: boolean;
  host: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  isDefaultChat: boolean;
  isDefaultEmbed: boolean;
}

export interface GetProvidersResponse {
  providers: ProviderOutput[];
  activeVault: string;
}

interface ProviderOutputWire {
  name: string;
  type: "cloud" | "local";
  api_key: string;
  api_key_set: boolean;
  host: string;
  base_url: string;
  chat_model: string;
  embed_model: string;
  is_default_chat: boolean;
  is_default_embed: boolean;
}

interface GetProvidersResponseWire {
  providers: ProviderOutputWire[];
  active_vault: string;
}

export async function loadProviderSettings(): Promise<GetProvidersResponse> {
  const wire = await request<GetProvidersResponseWire>("/api/settings/providers");
  return {
    activeVault: wire.active_vault,
    providers: wire.providers.map((p) => ({
      name: p.name,
      type: p.type,
      apiKey: p.api_key,
      apiKeySet: p.api_key_set,
      host: p.host,
      baseUrl: p.base_url,
      chatModel: p.chat_model,
      embedModel: p.embed_model,
      isDefaultChat: p.is_default_chat,
      isDefaultEmbed: p.is_default_embed,
    })),
  };
}

export function saveProviderSettings(providers: ProviderInput[]): Promise<SaveProvidersResponse> {
  const payload: SaveProvidersRequest = {
    providers: providers.map((p) => ({
      name: p.name,
      type: p.type,
      api_key: p.apiKey,
      host: p.host,
      base_url: p.baseUrl,
      chat_model: p.chatModel,
      embed_model: p.embedModel,
      is_default: p.isDefault,
    })),
  };
  return request<SaveProvidersResponse>("/api/settings/providers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// -- Archive ------------------------------------------------------------------

export function archiveNote(id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

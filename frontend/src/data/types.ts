export type NoteId = string;

export type NodeType =
  | "project"
  | "topic"
  | "people"
  | "daily"
  | "capture"
  | "custom";

export type NoteStatus = "active" | "archived";

export type Tab = "graph" | "thread" | "inbox" | "board";

export type GraphMode = "constellation" | "orbit";

export type BoardMode = "cards" | "round-table" | "pulse";

export type AgentLayer = "loom" | "shuttle";

export type AgentState = "running" | "queued" | "idle";

export type HistoryAction =
  | "created"
  | "edited"
  | "linked"
  | "archived"
  | "flagged"
  | "validated";

export type ActorTag = "you" | `agent:${string}`;

export interface HistoryEntry {
  action: HistoryAction;
  by: ActorTag;
  at: string;
  reason?: string;
}

export interface Note {
  id: NoteId;
  title: string;
  type: NodeType;
  folder: string;
  tags: string[];
  body: string;
  links: NoteId[];
  history: HistoryEntry[];
  created: string;
  modified: string;
  status: NoteStatus;
  source: string;
}

export type CaptureStatus = "pending" | "processing" | "done";

export interface CaptureSuggestion {
  type: NodeType;
  destFolder: string;
  tags: string[];
  links: NoteId[];
  title: string;
}

export interface Capture {
  id: string;
  title: string;
  folder: string;
  body: string;
  receivedAt: string;
  status: CaptureStatus;
  suggestion?: CaptureSuggestion;
  filedAs?: NoteId;
}

export interface Agent {
  id: string;
  name: string;
  layer: AgentLayer;
  role: string;
  icon: string;
  state: AgentState;
  stats: { runs: number; lastRun: string };
  lastAction: string;
}

export type SentinelVerdict = "ok" | "warn" | "fail";

export interface AgentEvent {
  id: string;
  ts: string;
  agent: string;
  action: string;
  target: string;
  chain: "ok" | "fail";
  sentinel: SentinelVerdict;
}

export type CouncilWho = "you" | "summary" | `agent:${string}`;

export interface CouncilMessage {
  id: string;
  who: CouncilWho;
  body: string;
  at: string;
}

export interface Toast {
  id: string;
  icon: string;
  agent?: string;
  body: string;
}

export type NoteId = string;

export type NodeType =
  | "project"
  | "topic"
  | "people"
  | "daily"
  | "capture"
  | "custom";

export type NoteStatus = "active" | "archived";

export type Tab = "graph" | "thread" | "inbox" | "board" | "settings";

export type SettingsSection =
  | "appearance"
  | "providers"
  | "connections"
  | "hardware"
  | "vault"
  | "archived"
  | "about"
  | "danger";

export type GraphLayout =
  | "force"
  | "rings"
  | "spiral"
  | "arms"
  | "galaxy"
  | "wave";

// Cards is the agent dashboard; pulse is an alternate viz of the same agents.
export type BoardMode = "cards" | "pulse";

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
  /** On-disk filename like ``caching.md``. Optional in seed data. */
  filename?: string;
  tags: string[];
  body: string;
  links: NoteId[];
  history: HistoryEntry[];
  created: string;
  modified: string;
  status: NoteStatus;
  source: string;
}

export type CaptureStatus =
  | "pending"
  | "processing"
  | "needs_review"
  | "failed"
  | "done";

export type CaptureOutcome = "filed" | "needs_review" | "skipped" | "failed";

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
  /** Where the capture came from: manual, bridge:browser, agent:researcher, … */
  source?: string;
  /** Stable identifier supplied by an external connector for deduplication. */
  externalId?: string;
  /** Connector-owned, display-safe provenance such as a canonical URL. */
  provenance?: Record<string, string>;
  outcome?: CaptureOutcome;
  reviewRequired?: boolean;
  flagged?: boolean;
  validation?: string;
  validationMode?: string;
  validationReasons?: string[];
  /** Draft created by Weaver but retained for user review after validation. */
  draftNoteId?: NoteId;
  draftNotePath?: string;
  lastAttemptOutcome?: CaptureOutcome;
  lastError?: string;
  lastAttemptAt?: string;
  filePath?: string;
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

/** Per-agent voice inside a council turn. Rendered as a sub-bubble. */
export interface CouncilContribution {
  agent: string;
  body: string;
  traceId?: string;
  error?: string;
}

export interface CouncilMessage {
  id: string;
  who: CouncilWho;
  body: string;
  at: string;
  traceId?: string;
  pending?: boolean;
  /** Per-agent contributions for ``who === "agent:council"`` messages. */
  contributions?: CouncilContribution[];
}

export interface Toast {
  id: string;
  icon: string;
  agent?: string;
  body: string;
}

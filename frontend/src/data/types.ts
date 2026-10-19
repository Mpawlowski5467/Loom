export type NoteId = string;

export type NodeType =
  | "project"
  | "topic"
  | "people"
  | "daily"
  | "capture"
  | "custom";

/** `superseded`: replaced by a newer note (see data/supersession.ts). */
export type NoteStatus = "active" | "archived" | "superseded";

/** Top-level views; each maps to a route (see app/routes.ts). */
export type Tab =
  | "graph"
  | "notes"
  | "board"
  | "inbox"
  | "threads"
  | "settings";

/** Settings sections, in nav order; each is `/settings/<section>`. */
export type SettingsSection =
  | "general"
  | "appearance"
  | "agents"
  | "models"
  | "privacy"
  | "integrations"
  | "vault";

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
  | "validated"
  | "superseded";

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
  /** Metadata-first navigation; undefined means a complete legacy/demo note. */
  bodyLoaded?: boolean;
  bodyError?: string;
  aliases?: string[];
  reviewRequired?: boolean;
  publication?: string;
  links: NoteId[];
  history: HistoryEntry[];
  created: string;
  modified: string;
  /** Opaque content hash used for cache invalidation and optimistic edits. */
  contentVersion?: string;
  status: NoteStatus;
  source: string;
  author?: string;
  /** Frontmatter fields Loom doesn't model explicitly (valid_from, …). */
  extra?: Record<string, unknown>;
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
  /** Weaver's persisted source coverage and originating link metadata. */
  sourceCoverage?: Record<string, unknown>;
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
  /** Vault-history commit this action produced; enables Board undo. */
  commit?: string | null;
  /** That commit has since been undone by a revert. */
  reverted?: boolean;
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
  /** Vault commits this reply made (gap 10: the Council doesn't write yet). */
  commits?: { sha: string; subject: string }[];
}

export interface Toast {
  id: string;
  icon: string;
  agent?: string;
  body: string;
}

import { createContext, useContext } from "react";
import type { AgentActivity } from "../api/activity";
import type { LoomConfigPublic, OnboardingCompleteRequest } from "../api/types";
import type { ThemeName } from "../theme/themes";
import type {
  Agent,
  AgentEvent,
  Capture,
  CaptureStatus,
  CouncilMessage,
  GraphLayout,
  Note,
  NoteId,
  NodeType,
  SettingsSection,
  Tab,
  Toast,
} from "../data/types";

export const GRAPH_LAYOUTS: readonly GraphLayout[] = [
  "force",
  "rings",
  "spiral",
  "arms",
  "galaxy",
  "wave",
] as const;

export const GRAPH_LAYOUT_LABELS: Record<GraphLayout, string> = {
  force: "Force",
  rings: "Rings",
  spiral: "Spiral",
  arms: "Arms",
  galaxy: "Galaxy",
  wave: "Wave",
};

export interface GraphDisplay {
  nodeSizeScale: number;
  labelThreshold: number;
  spacingScale: number;
  travelerPace: number;
  labelsEnabled: boolean;
  labelSize: number;
  labelShowRatio: number;
  edgeThickness: number;
  travelersEnabled: boolean;
  breathingEnabled: boolean;
  depthEnabled: boolean;
  layout: GraphLayout;
  layoutAutoCycle: boolean;
}

export const GRAPH_DISPLAY_DEFAULTS: GraphDisplay = {
  nodeSizeScale: 1.0,
  labelThreshold: 7,
  spacingScale: 1.0,
  travelerPace: 1.0,
  labelsEnabled: true,
  labelSize: 11,
  labelShowRatio: 1.0,
  edgeThickness: 1.0,
  travelersEnabled: true,
  breathingEnabled: true,
  depthEnabled: true,
  layout: "force",
  layoutAutoCycle: false,
};

export const GRAPH_DISPLAY_RANGES = {
  nodeSizeScale: { min: 0.5, max: 2.0, step: 0.1 },
  labelThreshold: { min: 1, max: 20, step: 1 },
  spacingScale: { min: 0.5, max: 2.0, step: 0.1 },
  travelerPace: { min: 0, max: 2.0, step: 0.1 },
  labelSize: { min: 8, max: 18, step: 1 },
  labelShowRatio: { min: 0.2, max: 4.0, step: 0.1 },
  edgeThickness: { min: 0.5, max: 3.0, step: 0.1 },
} as const;

export interface AppContextValue {
  notes: Note[];
  /** True once the initial note fetch has resolved (or in demo/offline mode). */
  notesLoaded: boolean;
  wikilinkMap: Map<string, NoteId>;
  resolveWikilink: (raw: string) => NoteId | undefined;
  noteById: (id: string) => Note | undefined;
  backlinksFor: (id: string) => string[];

  tab: Tab;
  setTab: (t: Tab) => void;
  settingsSection: SettingsSection;
  setSettingsSection: (s: SettingsSection) => void;
  currentNoteId: NoteId | null;
  openNote: (id: NoteId) => void;

  graphFocusId: NoteId | null;
  setGraphFocusId: (id: NoteId | null) => void;
  /** Persistent graph selection; separate from orbit layout focus. */
  graphSelectedId: NoteId | null;
  setGraphSelectedId: (id: NoteId | null) => void;
  /** Bumped to ask the graph to fly its camera to a node (e.g. from search). */
  graphFlyTo: { id: NoteId; nonce: number } | null;
  flyToNode: (id: NoteId) => void;
  graphFilters: Set<NodeType>;
  toggleGraphFilter: (t: NodeType) => void;
  clearGraphFilters: () => void;

  graphDisplay: GraphDisplay;
  setGraphDisplay: (patch: Partial<GraphDisplay>) => void;
  resetGraphDisplay: () => void;

  primaryOpen: boolean;
  secondaryOpen: boolean;
  editing: boolean;
  setPrimaryOpen: (b: boolean) => void;
  setSecondaryOpen: (b: boolean) => void;
  setEditing: (b: boolean) => void;

  /** Left file-tree visibility (graph/board tabs only), persisted. */
  treeVisible: boolean;
  setTreeVisible: (b: boolean) => void;

  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;

  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  agents: Agent[];
  agentActivity: Record<string, AgentActivity>;
  changelog: AgentEvent[];
  /** Notes present in the file index but missing from the search vector store. */
  unindexedCount: number;
  customAgents: Agent[];
  refreshCustomAgents: () => Promise<void>;

  council: CouncilMessage[];
  postCouncilMessage: (body: string) => Promise<void>;

  newNoteOpen: boolean;
  setNewNoteOpen: (open: boolean) => void;
  newNoteTitle: string | null;
  setNewNoteTitle: (t: string | null) => void;
  appendNote: (note: Note) => void;
  updateNote: (note: Note) => void;
  removeNote: (id: string) => void;

  extraFolders: string[];
  addFolder: (path: string) => void;

  captures: Capture[];
  capturesLoaded: boolean;
  capturesError: string | null;
  selectedCaptureId: string | null;
  selectCapture: (id: string | null) => void;
  setCaptureStatus: (id: string, s: CaptureStatus) => void;
  removeCapture: (id: string) => void;

  theme: ThemeName;
  setTheme: (t: ThemeName) => Promise<void>;
  followOsTheme: boolean;
  setFollowOsTheme: (on: boolean) => void;
  config: LoomConfigPublic | null;
  configLoading: boolean;
  configError: string | null;
  offline: boolean;
  refreshConfig: () => Promise<void>;
  onboardingComplete: boolean;
  completeOnboarding: (payload: OnboardingCompleteRequest) => Promise<void>;
}

export const AppCtx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp must be inside <AppProvider>");
  return v;
}

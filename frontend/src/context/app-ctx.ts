import { createContext, useContext } from "react";
import type { LoomConfigPublic, OnboardingCompleteRequest } from "../api/types";
import type { ThemeName } from "../theme/themes";
import type {
  Agent,
  AgentEvent,
  Capture,
  CaptureStatus,
  CouncilMessage,
  GraphMode,
  Note,
  NoteId,
  SettingsSection,
  Tab,
  Toast,
} from "../data/types";

export interface GraphDisplay {
  nodeSizeScale: number;
  labelThreshold: number;
  spacingScale: number;
}

export const GRAPH_DISPLAY_DEFAULTS: GraphDisplay = {
  nodeSizeScale: 1.0,
  labelThreshold: 7,
  spacingScale: 1.0,
};

export const GRAPH_DISPLAY_RANGES = {
  nodeSizeScale: { min: 0.5, max: 2.0, step: 0.1 },
  labelThreshold: { min: 1, max: 20, step: 1 },
  spacingScale: { min: 0.5, max: 2.0, step: 0.1 },
} as const;

export interface AppContextValue {
  notes: Note[];
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

  graphMode: GraphMode;
  setGraphMode: (m: GraphMode) => void;
  graphFocusId: NoteId | null;
  setGraphFocusId: (id: NoteId | null) => void;
  graphFilters: Set<string>;
  toggleGraphFilter: (t: string) => void;

  graphDisplay: GraphDisplay;
  setGraphDisplay: (patch: Partial<GraphDisplay>) => void;
  resetGraphDisplay: () => void;

  primaryOpen: boolean;
  secondaryOpen: boolean;
  editing: boolean;
  setPrimaryOpen: (b: boolean) => void;
  setSecondaryOpen: (b: boolean) => void;
  setEditing: (b: boolean) => void;

  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;

  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  agents: Agent[];
  changelog: AgentEvent[];

  council: CouncilMessage[];
  postCouncilMessage: (body: string) => void;

  captures: Capture[];
  selectedCaptureId: string | null;
  selectCapture: (id: string | null) => void;
  setCaptureStatus: (id: string, s: CaptureStatus) => void;

  theme: ThemeName;
  setTheme: (t: ThemeName) => Promise<void>;
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

import { createContext, useContext } from "react";
import type {
  Agent,
  AgentEvent,
  Capture,
  CaptureStatus,
  CouncilMessage,
  GraphMode,
  Note,
  NoteId,
  Tab,
  Toast,
} from "../data/types";

export interface AppContextValue {
  notes: Note[];
  wikilinkMap: Map<string, NoteId>;
  resolveWikilink: (raw: string) => NoteId | undefined;
  noteById: (id: string) => Note | undefined;
  backlinksFor: (id: string) => string[];

  tab: Tab;
  setTab: (t: Tab) => void;
  currentNoteId: NoteId | null;
  openNote: (id: NoteId) => void;

  graphMode: GraphMode;
  setGraphMode: (m: GraphMode) => void;
  graphFocusId: NoteId | null;
  setGraphFocusId: (id: NoteId | null) => void;
  graphFilters: Set<string>;
  toggleGraphFilter: (t: string) => void;

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
}

export const AppCtx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp must be inside <AppProvider>");
  return v;
}

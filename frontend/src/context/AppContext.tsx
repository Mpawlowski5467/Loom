import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  Agent,
  AgentEvent,
  Capture,
  CaptureStatus,
  CouncilMessage,
  CouncilWho,
  GraphMode,
  NoteId,
  Tab,
  Toast,
} from "../data/types";
import { agents as agentsSeed } from "../data/agents";
import { captures as capturesSeed } from "../data/captures";
import { changelogSeed } from "../data/changelog";
import { councilSeed } from "../data/council";
import { backlinksFor, noteById, notes as notesSeed } from "../data/notes";
import { AppCtx } from "./app-ctx";
import type { AppContextValue } from "./app-ctx";

interface ProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: ProviderProps): ReactNode {
  const notes = notesSeed;

  const wikilinkMap = useMemo(() => {
    const m = new Map<string, NoteId>();
    for (const n of notes) m.set(n.title.toLowerCase(), n.id);
    return m;
  }, [notes]);

  const resolveWikilink = useCallback(
    (raw: string): NoteId | undefined => {
      const key = raw.split("|")[0]!.trim().toLowerCase();
      return wikilinkMap.get(key);
    },
    [wikilinkMap],
  );

  const [tab, setTab] = useState<Tab>("graph");
  const [currentNoteId, setCurrentNoteId] = useState<NoteId | null>("thr_t001");

  const openNote = useCallback((id: NoteId) => {
    setCurrentNoteId(id);
    setTab("thread");
  }, []);

  const [graphMode, setGraphMode] = useState<GraphMode>("constellation");
  const [graphFocusId, setGraphFocusId] = useState<NoteId | null>(null);
  const [graphFilters, setGraphFilters] = useState<Set<string>>(new Set());
  const toggleGraphFilter = useCallback((t: string) => {
    setGraphFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const [primaryOpen, setPrimaryOpen] = useState(true);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [editing, setEditingRaw] = useState(false);

  const setEditing = useCallback((b: boolean) => {
    setEditingRaw(b);
    if (b) setSecondaryOpen(false);
  }, []);

  const [paletteOpen, setPaletteOpen] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const [agentsState] = useState<Agent[]>(agentsSeed);
  const [changelog] = useState<AgentEvent[]>(changelogSeed);

  const [council, setCouncil] = useState<CouncilMessage[]>(councilSeed);
  const postCouncilMessage = useCallback((body: string) => {
    if (!body.trim()) return;
    const youMsg: CouncilMessage = {
      id: `cm_${Date.now()}`,
      who: "you",
      body,
      at: new Date().toISOString(),
    };
    setCouncil((prev) => [...prev, youMsg]);
    const replies: { who: CouncilWho; body: string; delay: number }[] = [
      {
        who: "agent:weaver",
        body: "Noted. I'll check captures for anything relevant and report back.",
        delay: 900,
      },
      {
        who: "agent:sentinel",
        body: "I'll keep an eye on incoming edits for that.",
        delay: 1800,
      },
    ];
    replies.forEach((r, i) => {
      setTimeout(() => {
        setCouncil((prev) => [
          ...prev,
          {
            id: `cm_${Date.now()}_${i}`,
            who: r.who,
            body: r.body,
            at: new Date().toISOString(),
          },
        ]);
      }, r.delay);
    });
  }, []);

  const [captures, setCaptures] = useState<Capture[]>(capturesSeed);
  const [selectedCaptureId, selectCapture] = useState<string | null>(
    capturesSeed[0]?.id ?? null,
  );
  const setCaptureStatus = useCallback((id: string, s: CaptureStatus) => {
    setCaptures((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: s } : c)),
    );
  }, []);

  const value: AppContextValue = {
    notes,
    wikilinkMap,
    resolveWikilink,
    noteById,
    backlinksFor,

    tab,
    setTab,
    currentNoteId,
    openNote,

    graphMode,
    setGraphMode,
    graphFocusId,
    setGraphFocusId,
    graphFilters,
    toggleGraphFilter,

    primaryOpen,
    secondaryOpen,
    editing,
    setPrimaryOpen,
    setSecondaryOpen,
    setEditing,

    paletteOpen,
    setPaletteOpen,

    toasts,
    pushToast,
    dismissToast,

    agents: agentsState,
    changelog,

    council,
    postCouncilMessage,

    captures,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

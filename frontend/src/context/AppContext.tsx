import { useCallback, useEffect, useMemo, useState } from "react";
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
  SettingsSection,
  Tab,
  Toast,
} from "../data/types";
import { agents as agentsSeed } from "../data/agents";
import { captures as capturesSeed } from "../data/captures";
import { changelogSeed } from "../data/changelog";
import { councilSeed } from "../data/council";
import { backlinksFor, noteById, notes as notesSeed } from "../data/notes";
import { AppCtx } from "./app-ctx";
import type { AppContextValue, GraphDisplay } from "./app-ctx";
import { GRAPH_DISPLAY_DEFAULTS, GRAPH_DISPLAY_RANGES } from "./app-ctx";
import { useLoomConfig } from "./useLoomConfig";

const GRAPH_DISPLAY_KEY = "loom.graphDisplay";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function loadGraphDisplay(): GraphDisplay {
  if (typeof window === "undefined") return GRAPH_DISPLAY_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(GRAPH_DISPLAY_KEY);
    if (!raw) return GRAPH_DISPLAY_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<GraphDisplay>;
    return {
      nodeSizeScale: clamp(
        Number(parsed.nodeSizeScale ?? GRAPH_DISPLAY_DEFAULTS.nodeSizeScale),
        GRAPH_DISPLAY_RANGES.nodeSizeScale.min,
        GRAPH_DISPLAY_RANGES.nodeSizeScale.max,
      ),
      labelThreshold: clamp(
        Number(parsed.labelThreshold ?? GRAPH_DISPLAY_DEFAULTS.labelThreshold),
        GRAPH_DISPLAY_RANGES.labelThreshold.min,
        GRAPH_DISPLAY_RANGES.labelThreshold.max,
      ),
      spacingScale: clamp(
        Number(parsed.spacingScale ?? GRAPH_DISPLAY_DEFAULTS.spacingScale),
        GRAPH_DISPLAY_RANGES.spacingScale.min,
        GRAPH_DISPLAY_RANGES.spacingScale.max,
      ),
    };
  } catch {
    return GRAPH_DISPLAY_DEFAULTS;
  }
}

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
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("appearance");
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

  const [graphDisplay, setGraphDisplayState] =
    useState<GraphDisplay>(loadGraphDisplay);
  const setGraphDisplay = useCallback((patch: Partial<GraphDisplay>) => {
    setGraphDisplayState((prev) => {
      const merged: GraphDisplay = {
        nodeSizeScale: clamp(
          patch.nodeSizeScale ?? prev.nodeSizeScale,
          GRAPH_DISPLAY_RANGES.nodeSizeScale.min,
          GRAPH_DISPLAY_RANGES.nodeSizeScale.max,
        ),
        labelThreshold: clamp(
          patch.labelThreshold ?? prev.labelThreshold,
          GRAPH_DISPLAY_RANGES.labelThreshold.min,
          GRAPH_DISPLAY_RANGES.labelThreshold.max,
        ),
        spacingScale: clamp(
          patch.spacingScale ?? prev.spacingScale,
          GRAPH_DISPLAY_RANGES.spacingScale.min,
          GRAPH_DISPLAY_RANGES.spacingScale.max,
        ),
      };
      return merged;
    });
  }, []);
  const resetGraphDisplay = useCallback(() => {
    setGraphDisplayState(GRAPH_DISPLAY_DEFAULTS);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        GRAPH_DISPLAY_KEY,
        JSON.stringify(graphDisplay),
      );
    } catch {
      // ignore quota / serialization failures
    }
  }, [graphDisplay]);

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

  const loomConfig = useLoomConfig(pushToast);

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
    settingsSection,
    setSettingsSection,
    currentNoteId,
    openNote,

    graphMode,
    setGraphMode,
    graphFocusId,
    setGraphFocusId,
    graphFilters,
    toggleGraphFilter,

    graphDisplay,
    setGraphDisplay,
    resetGraphDisplay,

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

    ...loomConfig,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  Agent,
  Capture,
  CaptureStatus,
  CouncilMessage,
  CouncilWho,
  GraphMode,
  Note,
  NoteId,
  SettingsSection,
  Tab,
  Toast,
} from "../data/types";
import { agents as agentsSeed } from "../data/agents";
import { captures as capturesSeed } from "../data/captures";
import { changelogSeed } from "../data/changelog";
import { councilSeed } from "../data/council";
import { notes as notesSeed } from "../data/notes";
import { backendCaptureToFrontend, listCaptures } from "../api/captures";
import { backendNotesToFrontend, loadAllNotes } from "../api/notes";
import { loadChatHistory, streamCouncilMessage } from "../api/chat";
import { AppCtx } from "./app-ctx";
import type { AppContextValue, GraphDisplay } from "./app-ctx";
import { GRAPH_DISPLAY_DEFAULTS, GRAPH_DISPLAY_RANGES } from "./app-ctx";
import { useLoomConfig } from "./useLoomConfig";
import { useAgentPolling } from "./useAgentPolling";

const GRAPH_DISPLAY_KEY = "loom.graphDisplay";
const GRAPH_FILTERS_KEY = "loom.graphFilters";

function loadGraphFilters(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(GRAPH_FILTERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Demo data toggle — OFF by default so a fresh visit shows the new-user UI.
 * Enable for screenshots / dev by appending ``?demo=1`` to the URL; the
 * preference is persisted to ``localStorage["loom.demoMode"]`` so it
 * survives reloads until the user opts out with ``?demo=0``.
 */
const DEMO_LS_KEY = "loom.demoMode";

function readDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const qs = new URLSearchParams(window.location.search).get("demo");
    if (qs === "1") {
      window.localStorage.setItem(DEMO_LS_KEY, "1");
      return true;
    }
    if (qs === "0") {
      window.localStorage.removeItem(DEMO_LS_KEY);
      return false;
    }
    return window.localStorage.getItem(DEMO_LS_KEY) === "1";
  } catch {
    return false;
  }
}

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
      travelerPace: clamp(
        Number(parsed.travelerPace ?? GRAPH_DISPLAY_DEFAULTS.travelerPace),
        GRAPH_DISPLAY_RANGES.travelerPace.min,
        GRAPH_DISPLAY_RANGES.travelerPace.max,
      ),
      labelsEnabled:
        typeof parsed.labelsEnabled === "boolean"
          ? parsed.labelsEnabled
          : GRAPH_DISPLAY_DEFAULTS.labelsEnabled,
      labelSize: clamp(
        Number(parsed.labelSize ?? GRAPH_DISPLAY_DEFAULTS.labelSize),
        GRAPH_DISPLAY_RANGES.labelSize.min,
        GRAPH_DISPLAY_RANGES.labelSize.max,
      ),
      labelShowRatio: clamp(
        Number(parsed.labelShowRatio ?? GRAPH_DISPLAY_DEFAULTS.labelShowRatio),
        GRAPH_DISPLAY_RANGES.labelShowRatio.min,
        GRAPH_DISPLAY_RANGES.labelShowRatio.max,
      ),
      edgeThickness: clamp(
        Number(parsed.edgeThickness ?? GRAPH_DISPLAY_DEFAULTS.edgeThickness),
        GRAPH_DISPLAY_RANGES.edgeThickness.min,
        GRAPH_DISPLAY_RANGES.edgeThickness.max,
      ),
      travelersEnabled:
        typeof parsed.travelersEnabled === "boolean"
          ? parsed.travelersEnabled
          : GRAPH_DISPLAY_DEFAULTS.travelersEnabled,
      breathingEnabled:
        typeof parsed.breathingEnabled === "boolean"
          ? parsed.breathingEnabled
          : GRAPH_DISPLAY_DEFAULTS.breathingEnabled,
    };
  } catch {
    return GRAPH_DISPLAY_DEFAULTS;
  }
}

interface ProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: ProviderProps): ReactNode {
  const demo = useMemo(() => readDemoMode(), []);
  const [notes, setNotes] = useState<Note[]>(() => (demo ? notesSeed : []));
  // Demo seeds are present immediately; a live vault is "loaded" only after the
  // initial fetch resolves, so the tree can distinguish loading from empty.
  const [notesLoaded, setNotesLoaded] = useState<boolean>(() => demo);
  const appendNote = useCallback((note: Note) => {
    setNotes((prev) =>
      prev.some((n) => n.id === note.id) ? prev : [...prev, note],
    );
  }, []);
  const updateNote = useCallback((note: Note) => {
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === note.id);
      if (idx === -1) return [...prev, note];
      const next = prev.slice();
      next[idx] = note;
      return next;
    });
  }, []);
  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);
  const noteById = useCallback(
    (id: string): Note | undefined => notes.find((n) => n.id === id),
    [notes],
  );
  const backlinksFor = useCallback(
    (id: string): string[] =>
      notes.filter((n) => n.links.includes(id)).map((n) => n.id),
    [notes],
  );

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
  const [graphFlyTo, setGraphFlyTo] = useState<{
    id: NoteId;
    nonce: number;
  } | null>(null);
  const flyToNode = useCallback((id: NoteId) => {
    setTab("graph");
    setGraphFlyTo((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  const [graphFilters, setGraphFilters] = useState<Set<string>>(loadGraphFilters);
  const toggleGraphFilter = useCallback((t: string) => {
    setGraphFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        GRAPH_FILTERS_KEY,
        JSON.stringify([...graphFilters]),
      );
    } catch {
      // ignore quota / serialization failures
    }
  }, [graphFilters]);

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
        travelerPace: clamp(
          patch.travelerPace ?? prev.travelerPace,
          GRAPH_DISPLAY_RANGES.travelerPace.min,
          GRAPH_DISPLAY_RANGES.travelerPace.max,
        ),
        labelsEnabled: patch.labelsEnabled ?? prev.labelsEnabled,
        labelSize: clamp(
          patch.labelSize ?? prev.labelSize,
          GRAPH_DISPLAY_RANGES.labelSize.min,
          GRAPH_DISPLAY_RANGES.labelSize.max,
        ),
        labelShowRatio: clamp(
          patch.labelShowRatio ?? prev.labelShowRatio,
          GRAPH_DISPLAY_RANGES.labelShowRatio.min,
          GRAPH_DISPLAY_RANGES.labelShowRatio.max,
        ),
        edgeThickness: clamp(
          patch.edgeThickness ?? prev.edgeThickness,
          GRAPH_DISPLAY_RANGES.edgeThickness.min,
          GRAPH_DISPLAY_RANGES.edgeThickness.max,
        ),
        travelersEnabled: patch.travelersEnabled ?? prev.travelersEnabled,
        breathingEnabled: patch.breathingEnabled ?? prev.breathingEnabled,
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

  // Agents are part of the program (Weaver, Spider, …). Identities always
  // show; runtime stats / lastAction are only populated in demo mode.
  const [agentsState] = useState<Agent[]>(
    demo
      ? agentsSeed
      : agentsSeed.map((a) => ({
          ...a,
          state: "idle",
          stats: { runs: 0, lastRun: "—" },
          lastAction: "",
        })),
  );
  // Agent activity (1s) + changelog (3s) feed only the Board, so poll only
  // while it's the active tab, online, and not demo — never in the background.
  // Avoids 1s/3s network chatter when the user is on another view.
  const { changelog, agentActivity } = useAgentPolling(
    !demo &&
      loomConfig.onboardingComplete &&
      !loomConfig.offline &&
      tab === "board",
    demo ? changelogSeed : [],
  );

  const [customAgents, setCustomAgents] = useState<Agent[]>([]);
  const refreshCustomAgents = useCallback(async () => {
    try {
      const { listAgentRegistry } = await import("../api/agentsRegistry");
      const list = await listAgentRegistry();
      const custom: Agent[] = list
        .filter((a) => !a.system)
        .map((a) => ({
          id: a.id,
          name: a.name,
          layer: a.layer,
          role: a.role,
          icon: a.icon,
          state: "idle",
          stats: { runs: 0, lastRun: "—" },
          lastAction: "",
        }));
      setCustomAgents(custom);
    } catch {
      // Backend unreachable — leave the list as-is.
    }
  }, []);

  useEffect(() => {
    void refreshCustomAgents();
  }, [refreshCustomAgents]);

  const [council, setCouncil] = useState<CouncilMessage[]>(
    demo ? councilSeed : [],
  );
  // Load persisted council history once on mount so a page refresh doesn't
  // wipe the conversation. Skip in demo mode where seed messages are intentional.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void loadChatHistory("_council", 50)
      .then((res) => {
        if (cancelled || res.messages.length === 0) return;
        setCouncil(
          res.messages.map((m, i) => ({
            id: `cm_hist_${i}_${m.timestamp}`,
            who:
              m.role === "user"
                ? "you"
                : ("agent:council" as CouncilWho),
            body: m.content,
            at: m.timestamp,
          })),
        );
      })
      .catch(() => {
        // best-effort; empty council is the safe default
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const postCouncilMessage = useCallback(async (body: string) => {
    if (!body.trim()) return;
    const now = Date.now();
    const youMsg: CouncilMessage = {
      id: `cm_${now}`,
      who: "you",
      body,
      at: new Date().toISOString(),
    };
    const replyId = `cm_${now}_reply`;
    const replyMsg: CouncilMessage = {
      id: replyId,
      who: "agent:council" as CouncilWho,
      body: "",
      at: new Date().toISOString(),
      pending: true,
    };
    setCouncil((prev) => [...prev, youMsg, replyMsg]);

    const updateReply = (
      patch:
        | Partial<CouncilMessage>
        | ((m: CouncilMessage) => Partial<CouncilMessage>),
    ) => {
      setCouncil((prev) =>
        prev.map((m) =>
          m.id === replyId
            ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) }
            : m,
        ),
      );
    };

    try {
      await streamCouncilMessage(body, {
        onEvent: (event) => {
          if (event.kind === "contributions") {
            // Per-agent sub-bubbles arrive once fan-out completes; drop any
            // that are simultaneously silent and not-errored.
            const contribs = event.contributions
              .filter((c) => c.content.trim().length > 0 || c.error)
              .map((c) => ({
                agent: c.agent,
                body: c.content,
                traceId: c.trace_id || undefined,
                error: c.error || undefined,
              }));
            updateReply({ contributions: contribs.length > 0 ? contribs : undefined });
          } else if (event.kind === "token") {
            // Append the streamed chunk to the assistant bubble. ``pending``
            // stays true until ``done`` so the spinner-style affordance only
            // turns off once the aggregator has finished.
            updateReply((m) => ({ body: m.body + event.chunk }));
          } else if (event.kind === "done") {
            const finalContribs = event.contributions
              .filter((c) => c.content.trim().length > 0 || c.error)
              .map((c) => ({
                agent: c.agent,
                body: c.content,
                traceId: c.trace_id || undefined,
                error: c.error || undefined,
              }));
            updateReply({
              body: event.assistantText,
              traceId: event.traceId || undefined,
              contributions:
                finalContribs.length > 0 ? finalContribs : undefined,
              pending: false,
              at: new Date().toISOString(),
            });
          } else if (event.kind === "error") {
            updateReply({
              body: `⚠ ${event.message}`,
              pending: false,
            });
          }
        },
      });
      // Ensure pending is cleared even if the stream closed without a
      // ``done`` event (e.g. network drop mid-response).
      updateReply((m) => (m.pending ? { pending: false } : {}));
    } catch (err) {
      updateReply({
        body: `⚠ Failed: ${err instanceof Error ? err.message : String(err)}`,
        pending: false,
      });
    }
  }, []);

  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState<string | null>(null);

  const [captures, setCaptures] = useState<Capture[]>(
    demo ? capturesSeed : [],
  );
  const [selectedCaptureId, selectCapture] = useState<string | null>(
    demo ? capturesSeed[0]?.id ?? null : null,
  );

  useEffect(() => {
    // No live fetch in demo/offline/pre-onboarding — treat as already loaded
    // so the tree shows its empty state rather than a perpetual skeleton.
    if (demo || !loomConfig.onboardingComplete || loomConfig.offline) {
      setNotesLoaded(true);
      return;
    }
    const ctrl = new AbortController();

    void loadAllNotes(ctrl.signal)
      .then((records) => {
        if (ctrl.signal.aborted) return;
        const loaded = backendNotesToFrontend(records);
        setNotes(loaded);
        setCurrentNoteId((current) => {
          if (current && loaded.some((n) => n.id === current)) return current;
          return loaded[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if ((err as DOMException)?.name === "AbortError") return;
        pushToast({
          icon: "!",
          agent: "loom",
          body: err instanceof Error ? err.message : "Failed to load notes",
        });
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setNotesLoaded(true);
      });

    void listCaptures(ctrl.signal)
      .then((records) => {
        if (ctrl.signal.aborted) return;
        const loaded = records.map(backendCaptureToFrontend);
        setCaptures(loaded);
        selectCapture((current) => {
          if (current && loaded.some((c) => c.id === current)) return current;
          return loaded[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if ((err as DOMException)?.name === "AbortError") return;
        pushToast({
          icon: "!",
          agent: "loom",
          body: err instanceof Error ? err.message : "Failed to load captures",
        });
      });

    return () => ctrl.abort();
  }, [
    demo,
    loomConfig.config?.active_vault,
    loomConfig.offline,
    loomConfig.onboardingComplete,
    pushToast,
  ]);

  const setCaptureStatus = useCallback((id: string, s: CaptureStatus) => {
    setCaptures((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: s } : c)),
    );
  }, []);

  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const addFolder = useCallback((path: string) => {
    setExtraFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, []);

  const value: AppContextValue = {
    notes,
    notesLoaded,
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
    graphFlyTo,
    flyToNode,
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
    agentActivity,
    changelog,
    customAgents,
    refreshCustomAgents,

    council,
    postCouncilMessage,

    newNoteOpen,
    setNewNoteOpen,
    newNoteTitle,
    setNewNoteTitle,
    appendNote,
    updateNote,
    removeNote,

    captures,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,

    extraFolders,
    addFolder,

    ...loomConfig,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

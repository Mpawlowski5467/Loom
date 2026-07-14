import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  Agent,
  CouncilMessage,
  CouncilWho,
  NoteId,
  NodeType,
  SettingsSection,
  Tab,
  Toast,
} from "../data/types";
import { sanitizeGraphFilters } from "../graph/filtering";
import { agents as agentsSeed } from "../data/agents";
import { captures as capturesSeed } from "../data/captures";
import { changelogSeed } from "../data/changelog";
import { councilSeed } from "../data/council";
import { notes as notesSeed } from "../data/notes";
import {
  generateGraphFixture,
  parseGraphFixture,
  type GraphFixtureSize,
} from "../data/graphFixtures";
import { loadChatHistory, streamCouncilMessage } from "../api/chat";
import { AppCtx } from "./app-ctx";
import type { AppContextValue, GraphDisplay } from "./app-ctx";
import {
  GRAPH_DISPLAY_DEFAULTS,
  GRAPH_DISPLAY_RANGES,
  GRAPH_LAYOUTS,
} from "./app-ctx";
import { useLoomConfig } from "./useLoomConfig";
import { useAgentPolling } from "./useAgentPolling";
import { useHealthPolling } from "./useHealthPolling";
import { useVaultContent } from "./useVaultContent";

const GRAPH_DISPLAY_KEY = "loom.graphDisplay";
const GRAPH_FILTERS_KEY = "loom.graphFilters";
const TREE_VISIBLE_KEY = "loom.treeVisible";

function loadTreeVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(TREE_VISIBLE_KEY);
    if (raw === null) return true;
    const parsed = JSON.parse(raw);
    return typeof parsed === "boolean" ? parsed : true;
  } catch {
    return true;
  }
}

function loadGraphFilters(): Set<NodeType> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(GRAPH_FILTERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return sanitizeGraphFilters(parsed);
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

function readGraphFixture(): GraphFixtureSize | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return parseGraphFixture(window.location.search);
}

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

/** Older builds persisted the auto-cycle flag as ``orbitAutoCycle``.
 * (Their ``orbitScene`` is deliberately NOT migrated into ``layout``: the old
 * graph mode wasn't persisted and every session started in constellation, so
 * "force" — not the last-picked scene — is the faithful default.) */
type PersistedGraphDisplay = Partial<GraphDisplay> & {
  orbitAutoCycle?: unknown;
};

function loadGraphDisplay(): GraphDisplay {
  if (typeof window === "undefined") return GRAPH_DISPLAY_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(GRAPH_DISPLAY_KEY);
    if (!raw) return GRAPH_DISPLAY_DEFAULTS;
    const parsed = JSON.parse(raw) as PersistedGraphDisplay;
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
      depthEnabled:
        typeof parsed.depthEnabled === "boolean"
          ? parsed.depthEnabled
          : GRAPH_DISPLAY_DEFAULTS.depthEnabled,
      layout: (GRAPH_LAYOUTS as readonly string[]).includes(
        parsed.layout as string,
      )
        ? (parsed.layout as GraphDisplay["layout"])
        : GRAPH_DISPLAY_DEFAULTS.layout,
      layoutAutoCycle:
        typeof parsed.layoutAutoCycle === "boolean"
          ? parsed.layoutAutoCycle
          : typeof parsed.orbitAutoCycle === "boolean"
            ? parsed.orbitAutoCycle
            : GRAPH_DISPLAY_DEFAULTS.layoutAutoCycle,
    };
  } catch {
    return GRAPH_DISPLAY_DEFAULTS;
  }
}

interface ProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: ProviderProps): ReactNode {
  const graphFixture = useMemo(() => readGraphFixture(), []);
  const demo = useMemo(
    () => graphFixture !== null || readDemoMode(),
    [graphFixture],
  );
  const initialNotes = useMemo(
    () =>
      graphFixture !== null
        ? generateGraphFixture(graphFixture)
        : demo
          ? notesSeed
          : [],
    [demo, graphFixture],
  );
  const initialCaptures = useMemo(() => (demo ? capturesSeed : []), [demo]);

  const [tab, setTab] = useState<Tab>("graph");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("appearance");
  const [currentNoteId, setCurrentNoteId] = useState<NoteId | null>("thr_t001");

  const openNote = useCallback((id: NoteId) => {
    setCurrentNoteId(id);
    setTab("thread");
  }, []);

  const [graphFocusId, setGraphFocusId] = useState<NoteId | null>(null);
  const [graphSelectedId, setGraphSelectedId] = useState<NoteId | null>(null);
  const [graphFlyTo, setGraphFlyTo] = useState<{
    id: NoteId;
    nonce: number;
  } | null>(null);
  const flyToNode = useCallback((id: NoteId) => {
    setTab("graph");
    setGraphFlyTo((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  const [graphFilters, setGraphFilters] = useState<Set<NodeType>>(() =>
    graphFixture !== null ? new Set() : loadGraphFilters(),
  );
  const toggleGraphFilter = useCallback((t: NodeType) => {
    setGraphFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);
  const clearGraphFilters = useCallback(() => {
    setGraphFilters(new Set());
  }, []);
  useEffect(() => {
    if (graphFixture !== null || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        GRAPH_FILTERS_KEY,
        JSON.stringify([...graphFilters]),
      );
    } catch {
      // ignore quota / serialization failures
    }
  }, [graphFilters, graphFixture]);

  const [graphDisplay, setGraphDisplayState] = useState<GraphDisplay>(() =>
    graphFixture !== null ? GRAPH_DISPLAY_DEFAULTS : loadGraphDisplay(),
  );
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
        depthEnabled: patch.depthEnabled ?? prev.depthEnabled,
        layout:
          patch.layout !== undefined &&
          (GRAPH_LAYOUTS as readonly string[]).includes(patch.layout)
            ? patch.layout
            : prev.layout,
        layoutAutoCycle: patch.layoutAutoCycle ?? prev.layoutAutoCycle,
      };
      return merged;
    });
  }, []);
  const resetGraphDisplay = useCallback(() => {
    setGraphDisplayState(GRAPH_DISPLAY_DEFAULTS);
  }, []);
  useEffect(() => {
    if (graphFixture !== null || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        GRAPH_DISPLAY_KEY,
        JSON.stringify(graphDisplay),
      );
    } catch {
      // ignore quota / serialization failures
    }
  }, [graphDisplay, graphFixture]);

  const [primaryOpen, setPrimaryOpen] = useState(true);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [editing, setEditingRaw] = useState(false);

  const [treeVisible, setTreeVisible] = useState<boolean>(() =>
    graphFixture !== null ? false : loadTreeVisible(),
  );
  useEffect(() => {
    // The large dev fixture is a disposable benchmark surface. Keep its
    // tree closed so hundreds of DOM rows do not pollute graph timings, but
    // do not overwrite the user's real-vault preference while doing so.
    if (graphFixture !== null || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        TREE_VISIBLE_KEY,
        JSON.stringify(treeVisible),
      );
    } catch {
      // ignore quota / serialization failures
    }
  }, [graphFixture, treeVisible]);

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

  const liveLoomConfig = useLoomConfig(pushToast);
  // A graph fixture must render immediately even with no backend. The config
  // hook still owns theme behavior, while these read-only shell fields place
  // the app in its existing standalone/offline-ready phase.
  const loomConfig =
    graphFixture === null
      ? liveLoomConfig
      : {
          ...liveLoomConfig,
          config: null,
          configLoading: false,
          configError: null,
          offline: true,
          onboardingComplete: true,
        };

  const reportVaultContentError = useCallback(
    (_domain: "notes" | "captures", message: string) => {
      pushToast({ icon: "!", agent: "loom", body: message });
    },
    [pushToast],
  );
  const {
    notes,
    notesLoaded,
    wikilinkMap,
    resolveWikilink,
    noteById,
    backlinksFor,
    appendNote,
    updateNote,
    removeNote,
    captures,
    capturesLoaded,
    capturesError,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,
    removeCapture,
  } = useVaultContent({
    enabled: !demo && loomConfig.onboardingComplete && !loomConfig.offline,
    activeVault: loomConfig.config?.active_vault,
    initialNotes,
    initialCaptures,
    setCurrentNoteId,
    onLoadError: reportVaultContentError,
  });

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
  // Index-drift signal — slow poll (8s), independent of the active tab so the
  // banner shows wherever the user is. Off in demo/offline/pre-onboarding.
  const unindexedCount = useHealthPolling(
    !demo && loomConfig.onboardingComplete && !loomConfig.offline,
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
    if (graphFixture !== null) return;
    void refreshCustomAgents();
  }, [graphFixture, refreshCustomAgents]);

  const [council, setCouncil] = useState<CouncilMessage[]>(
    demo ? councilSeed : [],
  );
  // Tracks the in-flight Council SSE stream so a new send (or unmount) can
  // cancel it — a Council turn costs ~6 provider calls, so a leaked/duplicated
  // stream wastes a tight per-account budget.
  const councilAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      councilAbortRef.current?.abort();
    },
    [],
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
            who: m.role === "user" ? "you" : ("agent:council" as CouncilWho),
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
    // Cancel any stream still in flight before starting another, so a rapid
    // double-send doesn't run two uncancelled SSE fetches concurrently.
    councilAbortRef.current?.abort();
    const ctrl = new AbortController();
    councilAbortRef.current = ctrl;
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
        signal: ctrl.signal,
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
            updateReply({
              contributions: contribs.length > 0 ? contribs : undefined,
            });
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
      // An abort is a deliberate supersede/unmount, not a failure — leave the
      // bubble as-is (the newer send owns the UI now).
      if ((err as DOMException)?.name === "AbortError") return;
      updateReply({
        body: `⚠ Failed: ${err instanceof Error ? err.message : String(err)}`,
        pending: false,
      });
    } finally {
      // Only clear the ref if this call still owns it — a superseding send may
      // have already swapped in its own controller.
      if (councilAbortRef.current === ctrl) councilAbortRef.current = null;
    }
  }, []);

  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState<string | null>(null);

  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const addFolder = useCallback((path: string) => {
    setExtraFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, []);

  // Memoize the context value so the ~25 useApp() consumers don't all re-render
  // on every render of this provider (felt as jank with Sigma.js in the tree).
  //
  // CRITICAL: do NOT depend on the raw `loomConfig` object. `useLoomConfig`
  // returns a FRESH object literal every render, so a `[loomConfig]` dep (or
  // spreading `...loomConfig` so eslint demands it as a dep) would defeat the
  // memo entirely. We destructure its fields into locals here and depend on
  // those individually — the primitives that actually change (theme/config/etc.)
  // and its useCallback-stable callbacks. Everything else is changing state or a
  // stable useCallback / raw React setter (setters are guaranteed stable).
  const {
    theme: cfgTheme,
    followOsTheme: cfgFollowOsTheme,
    config: cfgConfig,
    configLoading: cfgConfigLoading,
    configError: cfgConfigError,
    offline: cfgOffline,
    onboardingComplete: cfgOnboardingComplete,
    setTheme: cfgSetTheme,
    setFollowOsTheme: cfgSetFollowOsTheme,
    refreshConfig: cfgRefreshConfig,
    completeOnboarding: cfgCompleteOnboarding,
  } = loomConfig;

  const value: AppContextValue = useMemo(
    () => ({
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

      graphFocusId,
      setGraphFocusId,
      graphSelectedId,
      setGraphSelectedId,
      graphFlyTo,
      flyToNode,
      graphFilters,
      toggleGraphFilter,
      clearGraphFilters,

      graphDisplay,
      setGraphDisplay,
      resetGraphDisplay,

      primaryOpen,
      secondaryOpen,
      editing,
      setPrimaryOpen,
      setSecondaryOpen,
      setEditing,

      treeVisible,
      setTreeVisible,

      paletteOpen,
      setPaletteOpen,

      toasts,
      pushToast,
      dismissToast,

      agents: agentsState,
      agentActivity,
      changelog,
      unindexedCount,
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
      capturesLoaded,
      capturesError,
      selectedCaptureId,
      selectCapture,
      setCaptureStatus,
      removeCapture,

      extraFolders,
      addFolder,

      // loomConfig fields (destructured into locals above, never the raw object)
      theme: cfgTheme,
      followOsTheme: cfgFollowOsTheme,
      config: cfgConfig,
      configLoading: cfgConfigLoading,
      configError: cfgConfigError,
      offline: cfgOffline,
      onboardingComplete: cfgOnboardingComplete,
      setTheme: cfgSetTheme,
      setFollowOsTheme: cfgSetFollowOsTheme,
      refreshConfig: cfgRefreshConfig,
      completeOnboarding: cfgCompleteOnboarding,
    }),
    [
      // Changing state
      notes,
      notesLoaded,
      wikilinkMap,
      tab,
      settingsSection,
      currentNoteId,
      graphFocusId,
      graphSelectedId,
      graphFlyTo,
      graphFilters,
      graphDisplay,
      primaryOpen,
      secondaryOpen,
      editing,
      treeVisible,
      paletteOpen,
      toasts,
      agentActivity,
      changelog,
      unindexedCount,
      customAgents,
      council,
      newNoteOpen,
      newNoteTitle,
      captures,
      capturesLoaded,
      capturesError,
      selectedCaptureId,
      extraFolders,
      // Stable callbacks / setters (referentially stable, listed for completeness)
      resolveWikilink,
      noteById,
      backlinksFor,
      setTab,
      setSettingsSection,
      openNote,
      setGraphFocusId,
      setGraphSelectedId,
      flyToNode,
      toggleGraphFilter,
      clearGraphFilters,
      setGraphDisplay,
      resetGraphDisplay,
      setPrimaryOpen,
      setSecondaryOpen,
      setEditing,
      setTreeVisible,
      setPaletteOpen,
      pushToast,
      dismissToast,
      agentsState,
      refreshCustomAgents,
      postCouncilMessage,
      setNewNoteOpen,
      setNewNoteTitle,
      appendNote,
      updateNote,
      removeNote,
      selectCapture,
      setCaptureStatus,
      removeCapture,
      addFolder,
      // loomConfig fields enumerated individually (NOT the raw object)
      cfgTheme,
      cfgFollowOsTheme,
      cfgConfig,
      cfgConfigLoading,
      cfgConfigError,
      cfgOffline,
      cfgOnboardingComplete,
      cfgSetTheme,
      cfgSetFollowOsTheme,
      cfgRefreshConfig,
      cfgCompleteOnboarding,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

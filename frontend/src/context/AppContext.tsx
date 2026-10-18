import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import type { Agent, Toast } from "../data/types";
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
import { readDemoMode } from "../data/demoMode";
import { AppCtx } from "./app-ctx";
import type { AppContextValue } from "./app-ctx";
import { useLoomConfig } from "./useLoomConfig";
import {
  BOARD_ACTIVITY_MS,
  HEADER_ACTIVITY_MS,
  useAgentPolling,
} from "./useAgentPolling";
import { useHealthPolling } from "./useHealthPolling";
import { useVaultContent } from "./useVaultContent";
import { useCouncil } from "./useCouncil";
import { useCustomAgents } from "./useCustomAgents";
import { useGraphNavigation } from "./useGraphNavigation";
import { useNoteRouting, useRoute } from "./useRouteNavigation";

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

function readGraphFixture(): GraphFixtureSize | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return parseGraphFixture(window.location.search);
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

  // Navigation lives in the URL (react-router); these are derived from it.
  const routeApi = useRoute();
  const {
    route,
    setTab,
    setSettingsSection,
    openNote,
    lastNoteId,
    setLastNoteId,
  } = routeApi;
  const tab = route.tab;
  const settingsSection = route.settingsSection;
  const noteHeading = route.heading;

  const {
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
  } = useGraphNavigation(graphFixture, setTab);

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

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);

  // Toasts render through Sonner (<Toaster /> in the app layout). The agent,
  // when present, is shown as the toast's description.
  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    toast(t.body, {
      description: t.agent
        ? t.agent.charAt(0).toUpperCase() + t.agent.slice(1)
        : undefined,
    });
  }, []);

  const liveLoomConfig = useLoomConfig();
  // A graph fixture must render immediately even with no backend. The config
  // hook still owns config loading, while these read-only shell fields place
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
    notesError,
    wikilinkMap,
    resolveWikilink,
    noteById,
    backlinksFor,
    appendNote,
    updateNote,
    removeNote,
    reloadNoteBody,
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
    currentNoteId: tab === "notes" ? lastNoteId : graphSelectedId,
    initialNotes,
    initialCaptures,
    setCurrentNoteId: setLastNoteId,
    onLoadError: reportVaultContentError,
  });
  const currentNoteId = useNoteRouting(routeApi, notes, notesLoaded);

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
  // The Board polls agent activity every second plus the changelog; every
  // other view polls activity slowly for the header's agent status. Nothing
  // polls offline, in demo mode, or before onboarding.
  const pollAgents =
    !demo && loomConfig.onboardingComplete && !loomConfig.offline;
  const onBoard = tab === "board";
  const { changelog, agentActivity } = useAgentPolling(
    {
      activityMs: !pollAgents
        ? null
        : onBoard
          ? BOARD_ACTIVITY_MS
          : HEADER_ACTIVITY_MS,
      changelog: pollAgents && onBoard,
    },
    demo ? changelogSeed : [],
  );
  // Index-drift signal — slow poll (8s), independent of the active tab so the
  // banner shows wherever the user is. Off in demo/offline/pre-onboarding.
  const unindexedCount = useHealthPolling(
    !demo && loomConfig.onboardingComplete && !loomConfig.offline,
  );

  const { customAgents, refreshCustomAgents } = useCustomAgents(
    graphFixture === null,
  );
  const { council, postCouncilMessage } = useCouncil(demo, councilSeed);

  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState<string | null>(null);
  const [councilPrefill, setCouncilPrefill] = useState<string | null>(null);

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
  // those individually — the primitives that actually change (config, onboarding, …)
  // and its useCallback-stable callbacks. Everything else is changing state or a
  // stable useCallback / raw React setter (setters are guaranteed stable).
  const {
    config: cfgConfig,
    configLoading: cfgConfigLoading,
    configError: cfgConfigError,
    offline: cfgOffline,
    onboardingComplete: cfgOnboardingComplete,
    refreshConfig: cfgRefreshConfig,
    completeOnboarding: cfgCompleteOnboarding,
  } = loomConfig;

  const value: AppContextValue = useMemo(
    () => ({
      notes,
      notesLoaded,
      notesError,
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
      noteHeading,

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

      treeVisible,
      setTreeVisible,

      paletteOpen,
      setPaletteOpen,
      quickCaptureOpen,
      setQuickCaptureOpen,

      pushToast,

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
      councilPrefill,
      setCouncilPrefill,
      appendNote,
      updateNote,
      removeNote,
      reloadNoteBody,

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
      config: cfgConfig,
      configLoading: cfgConfigLoading,
      configError: cfgConfigError,
      offline: cfgOffline,
      onboardingComplete: cfgOnboardingComplete,
      refreshConfig: cfgRefreshConfig,
      completeOnboarding: cfgCompleteOnboarding,
    }),
    [
      // Changing state
      notes,
      notesLoaded,
      notesError,
      wikilinkMap,
      tab,
      settingsSection,
      currentNoteId,
      noteHeading,
      graphFocusId,
      graphSelectedId,
      graphFlyTo,
      graphFilters,
      graphDisplay,
      treeVisible,
      paletteOpen,
      quickCaptureOpen,
      agentActivity,
      changelog,
      unindexedCount,
      customAgents,
      council,
      newNoteOpen,
      newNoteTitle,
      councilPrefill,
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
      setTreeVisible,
      setPaletteOpen,
      pushToast,
      agentsState,
      refreshCustomAgents,
      postCouncilMessage,
      setNewNoteOpen,
      setNewNoteTitle,
      appendNote,
      updateNote,
      removeNote,
      reloadNoteBody,
      selectCapture,
      setCaptureStatus,
      removeCapture,
      addFolder,
      // loomConfig fields enumerated individually (NOT the raw object)
      cfgConfig,
      cfgConfigLoading,
      cfgConfigError,
      cfgOffline,
      cfgOnboardingComplete,
      cfgRefreshConfig,
      cfgCompleteOnboarding,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

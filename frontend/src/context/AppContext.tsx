import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Agent, NoteId, SettingsSection, Tab, Toast } from "../data/types";
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
import { useAgentPolling } from "./useAgentPolling";
import { useHealthPolling } from "./useHealthPolling";
import { useVaultContent } from "./useVaultContent";
import { useCouncil } from "./useCouncil";
import { useCustomAgents } from "./useCustomAgents";
import { useGraphNavigation } from "./useGraphNavigation";

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

  const [tab, setTab] = useState<Tab>("graph");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("appearance");
  const [currentNoteId, setCurrentNoteId] = useState<NoteId | null>("thr_t001");

  const openNote = useCallback((id: NoteId) => {
    setCurrentNoteId(id);
    setTab("thread");
  }, []);

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
    notesError,
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

  const { customAgents, refreshCustomAgents } = useCustomAgents(
    graphFixture === null,
  );
  const { council, postCouncilMessage } = useCouncil(demo, councilSeed);

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
      notesError,
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

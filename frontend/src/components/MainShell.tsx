import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import type { Tab } from "../data/types";
import { backendNoteToFrontend, titleMapFromNotes } from "../api/notes";
import { Nav } from "./layout/Nav";
import { Tree } from "./layout/Tree";
import { Splash } from "../views/Splash";
import { GraphView } from "../views/GraphView";
import { ThreadView } from "../views/ThreadView";
import { InboxView } from "../views/InboxView";
import { BoardView } from "../views/BoardView";
import { SettingsView } from "../views/SettingsView";
import { NewNoteModal } from "../views/NewNoteModal";
import { Palette } from "../views/Palette";
import { Toasts } from "../views/Toasts";
import { LoomRibbon } from "./primitives/LoomRibbon";
import { UnindexedBanner } from "./UnindexedBanner";
import { ErrorBoundary } from "./ErrorBoundary";

const SPLASH_KEY = "loom.splash.seen";

const TAB_LABELS: Record<Tab, string> = {
  graph: "Graph",
  thread: "Thread",
  inbox: "Inbox",
  board: "Board",
  settings: "Settings",
};

function shouldShowSplash(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("splash") === "1") return true;
  try {
    return !sessionStorage.getItem(SPLASH_KEY);
  } catch {
    return true;
  }
}

/**
 * The main Loom interface — nav, tree, workspace, statusbar.
 *
 * Rendered by AppShell once onboarding is complete. Owns the post-onboarding
 * splash transition (the wizard handles the first-run intro itself).
 */
export function MainShell(): ReactNode {
  const {
    tab,
    setTab,
    paletteOpen,
    setPaletteOpen,
    newNoteOpen,
    setNewNoteOpen,
    newNoteTitle,
    setNewNoteTitle,
    notes,
    appendNote,
    openNote,
    setEditing,
    config,
    offline,
    unindexedCount,
    pushToast,
  } = useApp();
  const [showSplash, setShowSplash] = useState<boolean>(() =>
    shouldShowSplash(),
  );

  const dismissSplash = () => {
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowSplash(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (isMod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewNoteOpen(true);
      } else if (isMod && e.key === ";") {
        e.preventDefault();
        setTab("settings");
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen, setNewNoteOpen, setTab]);

  useEffect(() => {
    const vault = config?.active_vault?.trim() || "no vault";
    const view = TAB_LABELS[tab] ?? tab;
    document.title = `Loom — ${vault} — ${view}`;
  }, [tab, config?.active_vault]);

  const themeLabel = config?.ui.theme ?? "paper";
  const providerMissing = computeProviderMissing(config);

  return (
    <div className="app">
      {showSplash && <Splash onDone={dismissSplash} />}
      <ErrorBoundary label="the navigation bar">
        <Nav />
      </ErrorBoundary>
      {providerMissing && <ProviderBanner />}
      {offline && <OfflineBanner />}
      {!offline && unindexedCount > 0 && (
        <UnindexedBanner count={unindexedCount} />
      )}
      {tab === "settings" ? (
        <div className="app-main">
          <ErrorBoundary label="settings" resetKey={tab}>
            <SettingsView />
          </ErrorBoundary>
        </div>
      ) : (
        <div className="app-main">
          <ErrorBoundary label="the file tree">
            <Tree />
          </ErrorBoundary>
          <div className="workspace">
            <div className="workspace-main">
              {/* Keyed by tab so a view that throws is contained and switching
                  tabs recovers it without a full page reload. */}
              <ErrorBoundary label="this view" resetKey={tab}>
                {tab === "graph" && <GraphView />}
                {tab === "thread" && <ThreadView />}
                {tab === "inbox" && <InboxView />}
                {tab === "board" && <BoardView />}
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}
      <footer className="statusbar">
        <span>loom · {themeLabel} theme · v0.3.0</span>
        <span style={{ marginLeft: "auto" }}>
          {offline ? "offline" : "local-first"}
        </span>
      </footer>
      {paletteOpen && (
        <ErrorBoundary label="the command palette" resetKey={paletteOpen}>
          <Palette />
        </ErrorBoundary>
      )}
      {newNoteOpen && (
        <NewNoteModal
          initialTitle={newNoteTitle ?? ""}
          onClose={() => {
            setNewNoteOpen(false);
            setNewNoteTitle(null);
          }}
          onCreated={(record) => {
            const note = backendNoteToFrontend(record, titleMapFromNotes(notes));
            appendNote(note);
            openNote(note.id);
            // Drop straight into the editor — a fresh note is empty, so land
            // ready to type rather than on a blank read view.
            setEditing(true);
            setNewNoteTitle(null);
            pushToast({
              icon: "✎",
              agent: "weaver",
              body: `Created [[${record.title}]] in ${
                record.file_path.split("/threads/")[1] ?? record.file_path
              }`,
            });
          }}
        />
      )}
      <ErrorBoundary label="notifications">
        <Toasts />
      </ErrorBoundary>
      <LoomRibbon />
    </div>
  );
}

function computeProviderMissing(
  config: ReturnType<typeof useApp>["config"],
): boolean {
  if (!config) return false;
  if (!config.onboarding.completed) return false;
  const def = config.default_provider;
  if (!def) return true;
  const cfg = config.providers[def];
  if (!cfg) return true;
  // Ollama doesn't require an api_key, only a host.
  if (def === "ollama") return !cfg.host;
  return !cfg.api_key_set;
}

function ProviderBanner(): ReactNode {
  return (
    <div className="banner banner-provider" role="status">
      <span className="banner-icon" aria-hidden="true">
        ⌁
      </span>
      <span className="banner-body">
        No AI provider configured. Loom's agents are paused until you add one
        from Settings.
      </span>
    </div>
  );
}

function OfflineBanner(): ReactNode {
  return (
    <div className="banner banner-offline" role="status">
      <span className="banner-icon" aria-hidden="true">
        ⊘
      </span>
      <span className="banner-body">
        Backend unreachable. Changes will sync when it's back.
      </span>
    </div>
  );
}

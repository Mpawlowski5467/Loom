import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import type { NodeType, Note, Tab } from "../data/types";
import type { NoteRecord } from "../api/notes";
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

const SPLASH_KEY = "loom.splash.seen";

const TAB_LABELS: Record<Tab, string> = {
  graph: "Graph",
  thread: "Thread",
  inbox: "Inbox",
  board: "Board",
  settings: "Settings",
};

const NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "project",
  "topic",
  "people",
  "daily",
  "capture",
  "custom",
]);

/**
 * Convert a backend NoteRecord to the frontend Note shape used by the
 * graph / tree / thread view. The backend uses "person" while the frontend
 * NodeType is "people"; unknown types fall through to "custom".
 */
function backendNoteToFrontend(record: NoteRecord): Note {
  const rawType = record.type === "person" ? "people" : record.type;
  const type: NodeType = NODE_TYPES.has(rawType as NodeType)
    ? (rawType as NodeType)
    : "custom";
  // file_path looks like ".../threads/<folder>/<file>.md" — pull the folder.
  const parts = record.file_path.split("/threads/")[1]?.split("/") ?? [];
  const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  return {
    id: record.id,
    title: record.title,
    type,
    folder,
    tags: record.tags,
    body: record.body,
    links: record.links,
    history: record.history.map((h) => ({
      action: h.action as Note["history"][number]["action"],
      by: h.by as Note["history"][number]["by"],
      at: h.at,
      reason: h.reason,
    })),
    created: record.created,
    modified: record.modified,
    status: record.status === "archived" ? "archived" : "active",
    source: record.source,
  };
}

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
    appendNote,
    openNote,
    config,
    offline,
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
      <Nav />
      {providerMissing && <ProviderBanner />}
      {offline && <OfflineBanner />}
      {tab === "settings" ? (
        <div className="app-main">
          <SettingsView />
        </div>
      ) : (
        <div className="app-main">
          <Tree />
          <div className="workspace">
            <div className="workspace-main">
              {tab === "graph" && <GraphView />}
              {tab === "thread" && <ThreadView />}
              {tab === "inbox" && <InboxView />}
              {tab === "board" && <BoardView />}
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
      {paletteOpen && <Palette />}
      {newNoteOpen && (
        <NewNoteModal
          onClose={() => setNewNoteOpen(false)}
          onCreated={(record) => {
            const note = backendNoteToFrontend(record);
            appendNote(note);
            openNote(note.id);
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
      <Toasts />
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

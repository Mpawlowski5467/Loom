import type { ReactNode } from "react";
import { NotebookPen, Settings } from "lucide-react";
import { useApp } from "../../context/app-ctx";
import type { Tab } from "../../data/types";
import { LoomMark } from "../primitives/LoomMark";

const TABS: { value: Tab; label: string }[] = [
  { value: "graph", label: "Graph" },
  { value: "thread", label: "Thread" },
  { value: "inbox", label: "Inbox" },
  { value: "board", label: "Board" },
];

export function Nav(): ReactNode {
  const { tab, setTab, setPaletteOpen, setNewNoteOpen } = useApp();

  return (
    <header className="nav">
      <div className="logo">
        <span className="logo-mark">
          <LoomMark size={22} dur={6} loop />
        </span>
        <span>Loom</span>
      </div>
      <div className="tabs" role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            className="tab"
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="nav-spacer" />
      <button className="nav-search" onClick={() => setPaletteOpen(true)}>
        <span aria-hidden="true">⌕</span>
        <span>search vault…</span>
        <kbd>⌘K</kbd>
      </button>
      <button
        className="icon-btn nav-settings"
        type="button"
        aria-label="Open settings"
        aria-pressed={tab === "settings"}
        title="Settings (⌘;)"
        onClick={() => setTab("settings")}
      >
        <Settings size={15} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <button
        className="icon-btn nav-new"
        type="button"
        aria-label="New note"
        title="New note (⌘N)"
        onClick={() => setNewNoteOpen(true)}
      >
        <NotebookPen size={16} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </header>
  );
}

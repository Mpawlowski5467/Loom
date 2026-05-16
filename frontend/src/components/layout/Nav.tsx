import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import type { Tab } from "../../data/types";
import { Button } from "../primitives/Button";

const TABS: { value: Tab; label: string }[] = [
  { value: "graph", label: "Graph" },
  { value: "thread", label: "Thread" },
  { value: "inbox", label: "Inbox" },
  { value: "board", label: "Board" },
];

export function Nav(): ReactNode {
  const { tab, setTab, setPaletteOpen } = useApp();

  return (
    <header className="nav">
      <div className="logo">
        <div className="logo-mark" aria-hidden="true" />
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
      <Button variant="amber" size="md">
        + new
      </Button>
    </header>
  );
}

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Nav } from "./layout/Nav";
import { Tree } from "./layout/Tree";
import { Splash } from "../views/Splash";
import { GraphView } from "../views/GraphView";
import { ThreadView } from "../views/ThreadView";
import { InboxView } from "../views/InboxView";
import { BoardView } from "../views/BoardView";
import { Palette } from "../views/Palette";
import { Toasts } from "../views/Toasts";

const SPLASH_KEY = "loom.splash.seen";

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

export function AppShell(): ReactNode {
  const { tab, paletteOpen, setPaletteOpen } = useApp();
  const [showSplash, setShowSplash] = useState<boolean>(() => shouldShowSplash());

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
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  return (
    <div className="app">
      {showSplash && <Splash onDone={dismissSplash} />}
      <Nav />
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
      <footer className="statusbar">
        <span>loom · paper theme · v0.1</span>
        <span style={{ marginLeft: "auto" }}>local-first</span>
      </footer>
      {paletteOpen && <Palette />}
      <Toasts />
    </div>
  );
}

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/app/AppRoutes";
import { TAB_PATHS } from "@/app/routes";
import { useApp } from "@/context/app-ctx";
import type { Tab } from "@/data/types";
import { useAppearance } from "@/theme/appearance-ctx";
import { ErrorBoundary } from "../ErrorBoundary";
import { Tree } from "../layout/Tree";
import { UnindexedBanner } from "../UnindexedBanner";
import { ViewFallback } from "../ViewFallback";
import { Splash } from "../../views/Splash";
import { AppHeader } from "./AppHeader";
import { OfflineBanner, ProviderBanner } from "./Banners";
import { Overlays } from "./Overlays";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

const SPLASH_KEY = "loom.splash.seen";

const TAB_TITLES: Record<Tab, string> = {
  graph: "Graph",
  notes: "Notes",
  board: "Board",
  inbox: "Inbox",
  threads: "Threads",
  settings: "Settings",
};

function shouldShowSplash(): boolean {
  if (typeof window === "undefined") return false;
  if (new URL(window.location.href).searchParams.get("splash") === "1")
    return true;
  try {
    return !sessionStorage.getItem(SPLASH_KEY);
  } catch {
    return true;
  }
}

function providerMissing(config: ReturnType<typeof useApp>["config"]): boolean {
  if (!config || !config.onboarding.completed) return false;
  const def = config.default_provider;
  const cfg = def ? config.providers[def] : undefined;
  if (!cfg) return true;
  // Ollama needs a host, not an API key.
  return def === "ollama" ? !cfg.host : !cfg.api_key_set;
}

/**
 * The app shell once onboarding is done: header, status banners, the routed
 * view (with the file tree beside Graph and Board), overlays and toasts.
 */
export function AppLayout(): ReactNode {
  const app = useApp();
  const { tab, config, offline, unindexedCount, treeVisible, setTreeVisible } =
    app;
  const { mode } = useAppearance();
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(shouldShowSplash);
  const treeAvailable = tab === "graph" || tab === "board";

  useGlobalShortcuts({
    togglePalette: () => app.setPaletteOpen(!app.paletteOpen),
    closePalette: () => {
      if (!app.paletteOpen) return false;
      app.setPaletteOpen(false);
      return true;
    },
    newNote: () => app.setNewNoteOpen(true),
    quickCapture: () => app.setQuickCaptureOpen(true),
    toggleTree: treeAvailable ? () => setTreeVisible(!treeVisible) : null,
    openSettings: () => app.setTab("settings"),
    goTo: (target) =>
      target === "notes" ? app.setTab("notes") : navigate(TAB_PATHS[target]),
  });

  useEffect(() => {
    const vault = config?.active_vault?.trim() || "no vault";
    document.title = `Loom — ${vault} — ${TAB_TITLES[tab]}`;
  }, [tab, config?.active_vault]);

  const dismissSplash = () => {
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowSplash(false);
  };

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {showSplash && <Splash onDone={dismissSplash} />}
        <ErrorBoundary label="the header">
          <AppHeader />
        </ErrorBoundary>
        {providerMissing(config) && <ProviderBanner />}
        {offline && <OfflineBanner />}
        {!offline && unindexedCount > 0 && (
          <UnindexedBanner count={unindexedCount} />
        )}
        <div className="flex min-h-0 flex-1">
          {treeAvailable && treeVisible && (
            <ErrorBoundary label="the file tree">
              <Tree />
            </ErrorBoundary>
          )}
          <main className="relative flex min-w-0 flex-1 flex-col">
            {/* Keyed by tab so a view that throws is contained, and switching
                views recovers it without a reload. */}
            <ErrorBoundary label="this view" resetKey={tab}>
              <Suspense fallback={<ViewFallback />}>
                <AppRoutes />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
        <Overlays />
        <Toaster theme={mode} position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

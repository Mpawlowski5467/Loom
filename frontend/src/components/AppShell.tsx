import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { MainShell } from "./MainShell";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";

type ShellPhase = "loading" | "onboarding" | "ready";

/**
 * Phase router. While the config is in flight we paint nothing visible — the
 * page stays on the theme that ``main.tsx`` already applied. Once we know
 * whether onboarding is complete we either drop the user into the wizard or
 * the main shell. The post-onboarding splash lives inside MainShell.
 */
export function AppShell(): ReactNode {
  const { config, configLoading, offline, onboardingComplete } = useApp();

  const phase: ShellPhase = decidePhase({
    config: !!config,
    configLoading,
    offline,
    onboardingComplete,
  });

  if (phase === "loading") {
    return <BootScreen />;
  }
  if (phase === "onboarding") {
    return <OnboardingFlow />;
  }
  return <MainShell />;
}

function decidePhase(args: {
  config: boolean;
  configLoading: boolean;
  offline: boolean;
  onboardingComplete: boolean;
}): ShellPhase {
  // Offline at boot — we never got a config. Treat as already-onboarded so the
  // user can at least poke around the seeded UI; the offline banner makes the
  // state clear.
  if (args.offline && !args.config) return "ready";
  if (args.configLoading && !args.config) return "loading";
  return args.onboardingComplete ? "ready" : "onboarding";
}

function BootScreen(): ReactNode {
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <div className="boot-mark" aria-hidden="true" />
      <span className="boot-label">loom</span>
    </div>
  );
}

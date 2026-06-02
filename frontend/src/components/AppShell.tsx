import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { MainShell } from "./MainShell";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import { decidePhase, useBootTimeout } from "./useBootTimeout";

/**
 * Phase router. While the config is in flight we paint a minimal boot screen.
 * If it never resolves (slow/wedged backend) we surface a Retry instead of an
 * infinite spinner. Once we know whether onboarding is complete we drop the
 * user into the wizard or the main shell. The post-onboarding splash lives
 * inside MainShell.
 */
export function AppShell(): ReactNode {
  const { config, configLoading, offline, onboardingComplete, refreshConfig } =
    useApp();

  const stillBooting = configLoading && !config && !offline;
  const timedOut = useBootTimeout(stillBooting);

  const phase = decidePhase({
    config: !!config,
    configLoading,
    offline,
    onboardingComplete,
    timedOut,
  });

  if (phase === "loading") {
    return <BootScreen />;
  }
  if (phase === "timeout") {
    return <BootScreen timedOut onRetry={refreshConfig} />;
  }
  if (phase === "onboarding") {
    return <OnboardingFlow />;
  }
  return <MainShell />;
}

function BootScreen({
  timedOut = false,
  onRetry,
}: {
  timedOut?: boolean;
  onRetry?: () => void;
}): ReactNode {
  if (timedOut) {
    return (
      <div className="boot-screen boot-screen-error" role="alert">
        <div className="boot-mark" aria-hidden="true" />
        <span className="boot-label">loom</span>
        <p className="boot-error-body">
          Couldn&rsquo;t reach the backend. Make sure it&rsquo;s running, then
          retry.
        </p>
        {onRetry && (
          <button type="button" className="boot-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <div className="boot-mark" aria-hidden="true" />
      <span className="boot-label">loom</span>
    </div>
  );
}

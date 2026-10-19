import { CloudOff } from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { BootError, BootScreen } from "./BootScreen";
import { AppLayout } from "./shell/AppLayout";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import { decidePhase, useBootTimeout } from "./useBootTimeout";

/**
 * Phase router. While the config is in flight we paint a minimal boot screen.
 * If it never resolves (slow/wedged backend) we surface a Retry instead of an
 * infinite spinner. Once we know whether onboarding is complete we drop the
 * user into the wizard or the app layout. The post-onboarding splash lives
 * inside AppLayout.
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
    return (
      <BootError
        icon={CloudOff}
        message={
          <>
            Couldn&rsquo;t reach the backend. Make sure it&rsquo;s running, then
            retry.
          </>
        }
        actionLabel="Retry"
        onAction={refreshConfig}
      />
    );
  }
  if (phase === "onboarding") {
    return <OnboardingFlow />;
  }
  return <AppLayout />;
}

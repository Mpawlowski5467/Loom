import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { resetOnboarding } from "@/api/onboarding";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import {
  getDiagnostics,
  getHealth,
  getIndexStats,
  type DiagnosticsResponse,
  type HealthResponse,
  type IndexStats,
} from "@/api/diagnostics";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { ApiLinks } from "./general/ApiLinks";
import { BackendCard } from "./general/BackendCard";
import { IndexStatsGroup } from "./general/IndexStatsGroup";
import { InfoGrid, InfoRow } from "./general/InfoGrid";
import { SecurityGroup } from "./general/SecurityGroup";
import { describeApiError } from "@/api/client";

/** Settings → General: diagnostics, access boundary, index and setup. */
export function AboutSection(): ReactNode {
  const { refreshConfig } = useApp();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(
    null,
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Accessible confirm dialog (replaces window.confirm) for re-running onboarding.
  const [confirmRerun, setConfirmRerun] = useState(false);

  // Runs after the user confirms in the modal. Errors propagate so the
  // ConfirmModal shows them inline and stays open for a retry.
  const rerunOnboarding = async () => {
    await resetOnboarding();
    await refreshConfig();
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getDiagnostics(), getHealth(), getIndexStats()])
      .then(([diag, report, stats]) => {
        if (cancelled) return;
        setDiagnostics(diag);
        setHealth(report);
        setIndexStats(stats);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessage(describeApiError(err, "Diagnostics failed"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyVaultPath = async () => {
    if (!diagnostics) return;
    await navigator.clipboard.writeText(diagnostics.vault_path);
    setMessage("Vault path copied.");
  };

  const frontendVersion =
    (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";

  return (
    <>
      <SettingsGroup level={1} title="Diagnostics">
        <InfoGrid>
          <InfoRow
            label="Version"
            value={diagnostics?.app_version ?? "…"}
            mono
          />
          <InfoRow label="Frontend" value={frontendVersion} mono />
          <InfoRow
            label="Python"
            value={diagnostics?.python_version ?? "…"}
            mono
          />
          <InfoRow
            label="Started"
            value={
              diagnostics
                ? new Date(diagnostics.started_at).toLocaleString()
                : "…"
            }
            mono
          />
          <InfoRow
            label="Built"
            value={
              diagnostics?.build_date
                ? new Date(diagnostics.build_date).toLocaleString()
                : diagnostics
                  ? "Unknown"
                  : "…"
            }
            mono
          />
          <InfoRow
            label="Providers"
            value={diagnostics?.providers_configured.join(", ") || "None"}
          />
        </InfoGrid>
        <BackendCard
          health={health}
          vaultPath={diagnostics?.vault_path}
          logPath={diagnostics?.log_path}
          onCopyPath={diagnostics ? () => void copyVaultPath() : null}
        />
        {message && <StatusLine>{message}</StatusLine>}
        <ApiLinks />
      </SettingsGroup>
      <SecurityGroup diagnostics={diagnostics} />
      <IndexStatsGroup stats={indexStats} />
      <SettingsGroup
        title="Setup"
        description="Re-run the first-run wizard. Your vault and provider settings are kept."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmRerun(true)}
          >
            <RotateCcw aria-hidden="true" />
            Re-run onboarding
          </Button>
        }
      />
      {confirmRerun && (
        <ConfirmModal
          title="Re-run the onboarding wizard?"
          body="Your vault and provider settings are kept. You'll step through the first-run wizard again."
          confirmLabel="Re-run onboarding"
          destructive={false}
          onConfirm={rerunOnboarding}
          onClose={() => setConfirmRerun(false)}
        />
      )}
    </>
  );
}

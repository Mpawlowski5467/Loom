import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Clipboard, ExternalLink, RotateCcw } from "lucide-react";
import { API_BASE } from "../../api/client";
import { resetOnboarding } from "../../api/onboarding";
import { useApp } from "../../context/app-ctx";
import {
  getDiagnostics,
  getHealth,
  type DiagnosticsResponse,
  type HealthResponse,
} from "../../api/diagnostics";

export function AboutSection(): ReactNode {
  const { refreshConfig } = useApp();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(
    null,
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rerunOnboarding = async () => {
    const ok = window.confirm(
      "Re-run the onboarding wizard? Your vault and provider settings are kept.",
    );
    if (!ok) return;
    try {
      await resetOnboarding();
      await refreshConfig();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't reset onboarding.");
    }
  };

  useEffect(() => {
    void Promise.all([getDiagnostics(), getHealth()])
      .then(([diag, report]) => {
        setDiagnostics(diag);
        setHealth(report);
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "Diagnostics failed");
      });
  }, []);

  const copyVaultPath = async () => {
    if (!diagnostics) return;
    await navigator.clipboard.writeText(diagnostics.vault_path);
    setMessage("Vault path copied.");
  };

  const frontendVersion =
    (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";

  return (
    <div className="settings-panel">
      <div className="settings-kicker">About</div>
      <h1 className="settings-title">Diagnostics</h1>
      <div className="settings-diagnostics-grid">
        <InfoRow label="Version" value={diagnostics?.app_version ?? "…"} />
        <InfoRow label="Frontend" value={frontendVersion} />
        <InfoRow label="Python" value={diagnostics?.python_version ?? "…"} />
        <InfoRow
          label="Started"
          value={
            diagnostics
              ? new Date(diagnostics.started_at).toLocaleString()
              : "…"
          }
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
        />
        <InfoRow
          label="Providers"
          value={diagnostics?.providers_configured.join(", ") || "None"}
        />
      </div>
      <div className="settings-about-card">
        <div>
          <div className="settings-field-label">Backend</div>
          <span
            className={`settings-health-pill ${health?.ok ? "ok" : "warn"}`}
          >
            {health?.ok ? "Ready" : "Limited"}
          </span>
        </div>
        <div>
          <div className="settings-field-label">Vault path</div>
          <div className="settings-vault-path">
            {diagnostics?.vault_path ?? "Loading…"}
          </div>
        </div>
        <div>
          <div className="settings-field-label">Logs</div>
          <div className="settings-vault-path">
            {diagnostics?.log_path ?? "Loading…"}
          </div>
        </div>
        <button
          className="btn btn-md"
          type="button"
          onClick={() => void copyVaultPath()}
          disabled={!diagnostics}
        >
          <Clipboard size={14} aria-hidden="true" />
          Copy path
        </button>
      </div>
      <div className="settings-about-card">
        <div>
          <div className="settings-field-label">Setup</div>
          <p className="settings-copy settings-copy-tight">
            Re-run the first-run wizard. Your vault and provider settings are
            kept.
          </p>
        </div>
        <button
          className="btn btn-md"
          type="button"
          onClick={() => void rerunOnboarding()}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Re-run onboarding
        </button>
      </div>
      <div className="settings-link-row">
        <a href={`${API_BASE}/api/health`} target="_blank" rel="noreferrer">
          Health <ExternalLink size={13} aria-hidden="true" />
        </a>
        <a
          href={`${API_BASE}/api/diagnostics`}
          target="_blank"
          rel="noreferrer"
        >
          Diagnostics <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      {message && <div className="settings-inline-status">{message}</div>}
    </div>
  );
}

function InfoRow(props: { label: string; value: string }): ReactNode {
  return (
    <div className="settings-info-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

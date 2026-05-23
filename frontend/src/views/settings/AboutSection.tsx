import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Clipboard, ExternalLink } from "lucide-react";
import { API_BASE } from "../../api/client";
import {
  getDiagnostics,
  getHealth,
  type DiagnosticsResponse,
  type HealthResponse,
} from "../../api/diagnostics";

export function AboutSection(): ReactNode {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(
    null,
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <div className="settings-panel">
      <div className="settings-kicker">About</div>
      <h1 className="settings-title">Diagnostics</h1>
      <div className="settings-diagnostics-grid">
        <InfoRow label="Version" value={diagnostics?.app_version ?? "…"} />
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

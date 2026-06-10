import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Clipboard, ExternalLink, RotateCcw } from "lucide-react";
import { API_BASE } from "../../api/client";
import { resetOnboarding } from "../../api/onboarding";
import { ConfirmModal } from "../../components/ConfirmModal";
import { useApp } from "../../context/app-ctx";
import {
  getDiagnostics,
  getHealth,
  getIndexStats,
  type DiagnosticsResponse,
  type HealthResponse,
  type IndexStats,
} from "../../api/diagnostics";

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
        setMessage(err instanceof Error ? err.message : "Diagnostics failed");
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
          {health && (
            <ul className="settings-health-components">
              {Object.entries(health.components).map(([name, c]) => (
                <li key={name} className="settings-health-component">
                  <span
                    className={`settings-health-dot ${c.ready ? "ok" : "warn"}`}
                    aria-hidden="true"
                  />
                  <span className="settings-health-component-name">{name}</span>
                  <span className="settings-health-component-detail">
                    {c.ready
                      ? c.count !== undefined
                        ? `${c.count}`
                        : "ready"
                      : (c.details ?? "not ready")}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
          onClick={() => setConfirmRerun(true)}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Re-run onboarding
        </button>
      </div>
      <div className="settings-kicker">Search index</div>
      <h1 className="settings-title">Vector index</h1>
      {indexStats && !indexStats.ready ? (
        <p className="settings-copy settings-copy-tight">
          No vector index yet. Configure an embed provider and reindex
          (Settings → Providers) so semantic search has data.
          {indexStats.unindexed_count > 0 &&
            ` ${indexStats.unindexed_count} note(s) await indexing.`}
        </p>
      ) : (
        <>
          <div className="settings-diagnostics-grid">
            <InfoRow
              label="Chunks"
              value={indexStats?.total_chunks.toString() ?? "…"}
            />
            <InfoRow
              label="Notes indexed"
              value={indexStats?.distinct_notes.toString() ?? "…"}
            />
            <InfoRow
              label="Unindexed"
              value={indexStats?.unindexed_count.toString() ?? "…"}
            />
            <InfoRow
              label="Avg chunks / note"
              value={indexStats?.avg_chunks_per_note.toFixed(1) ?? "…"}
            />
          </div>
          {indexStats &&
            Object.keys(indexStats.type_breakdown).length > 0 && (
              <div className="settings-about-card">
                <div>
                  <div className="settings-field-label">Chunks by type</div>
                  <ul className="settings-health-components">
                    {Object.entries(indexStats.type_breakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <li
                          key={type}
                          className="settings-health-component"
                        >
                          <span className="settings-health-component-name">
                            {type}
                          </span>
                          <span className="settings-health-component-detail">
                            {count}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}
        </>
      )}
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
        <a href={`${API_BASE}/api/traces`} target="_blank" rel="noreferrer">
          LLM traces <ExternalLink size={13} aria-hidden="true" />
        </a>
        <a
          href={`${API_BASE}/api/index/stats`}
          target="_blank"
          rel="noreferrer"
        >
          Index stats <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      {message && <div className="settings-inline-status">{message}</div>}
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

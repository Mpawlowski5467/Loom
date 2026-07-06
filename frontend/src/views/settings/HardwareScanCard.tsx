import { useState } from "react";
import type { ReactNode } from "react";
import { ScanSearch, Save } from "lucide-react";
import { getHardware, saveHardware } from "../../api/hardware";
import type { HardwareResponse } from "../../api/types";

/** Scan the host machine and persist the profile the model advisor rates against. */
export function HardwareScanCard(): ReactNode {
  const [data, setData] = useState<HardwareResponse | null>(null);
  const [busy, setBusy] = useState<"scan" | "save" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const scan = async () => {
    setBusy("scan");
    setStatus(null);
    try {
      setData(await getHardware());
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Hardware scan failed");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!data) return;
    setBusy("save");
    setStatus(null);
    try {
      const res = await saveHardware(data.profile);
      setData({ profile: data.profile, saved: res.saved });
      setStatus("Profile saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Saving the profile failed");
    } finally {
      setBusy(null);
    }
  };

  const profile = data?.profile ?? null;
  return (
    <section>
      <h2 className="settings-subhead">Your machine</h2>
      <p className="settings-copy settings-copy-tight">
        Scan this machine so model recommendations reflect what it can actually
        run. Saving keeps the profile for future ratings.
      </p>
      <div className="settings-actions">
        <button
          className="btn btn-md"
          type="button"
          disabled={busy !== null}
          onClick={() => void scan()}
        >
          <ScanSearch size={14} aria-hidden="true" />
          {busy === "scan" ? "Scanning…" : "Scan hardware"}
        </button>
        <button
          className="btn btn-md btn-active"
          type="button"
          disabled={!profile || busy !== null}
          onClick={() => void save()}
        >
          <Save size={14} aria-hidden="true" />
          {busy === "save" ? "Saving…" : "Save profile"}
        </button>
        {data?.saved && (
          <span className="settings-action-note">
            Saved profile from{" "}
            {new Date(data.saved.scanned_at).toLocaleString()}
          </span>
        )}
      </div>
      {profile && (
        <>
          <div className="settings-diagnostics-grid">
            <InfoRow label="CPU" value={profile.cpu_model || "Unknown"} />
            <InfoRow label="Cores" value={profile.cpu_cores.toString()} />
            <InfoRow
              label="RAM"
              value={profile.ram_gb > 0 ? `${profile.ram_gb} GB` : "Unknown"}
            />
            <InfoRow label="GPU" value={gpuLabel(profile.gpu_name, profile.vram_gb)} />
            <InfoRow label="OS" value={profile.os || "Unknown"} />
          </div>
          {profile.unified_memory && (
            <p className="settings-field-hint">
              Unified memory: the GPU shares system RAM, so models draw from
              the full {profile.ram_gb} GB.
            </p>
          )}
        </>
      )}
      {status && <div className="settings-inline-status">{status}</div>}
    </section>
  );
}

function gpuLabel(name: string | null, vramGb: number | null): string {
  if (!name) return "None detected";
  return vramGb ? `${name} · ${vramGb} GB VRAM` : name;
}

function InfoRow(props: { label: string; value: string }): ReactNode {
  return (
    <div className="settings-info-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

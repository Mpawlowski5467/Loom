import { useState } from "react";
import type { ReactNode } from "react";
import { ScanSearch, Save } from "lucide-react";
import { getHardware, saveHardware } from "@/api/hardware";
import type { HardwareResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine, type StatusTone } from "./kit/StatusLine";
import { describeApiError } from "@/api/client";

/** Scan the host machine and persist the profile the model advisor rates against. */
export function HardwareScanCard(): ReactNode {
  const [data, setData] = useState<HardwareResponse | null>(null);
  const [busy, setBusy] = useState<"scan" | "save" | null>(null);
  const [status, setStatus] = useState<{
    text: string;
    tone: StatusTone;
  } | null>(null);

  const scan = async () => {
    setBusy("scan");
    setStatus(null);
    try {
      setData(await getHardware());
    } catch (err) {
      setStatus({
        text: describeApiError(err, "Hardware scan failed"),
        tone: "error",
      });
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
      setStatus({ text: "Profile saved.", tone: "ok" });
    } catch (err) {
      setStatus({
        text: describeApiError(err, "Saving the profile failed"),
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const profile = data?.profile ?? null;
  return (
    <SettingsGroup
      level={3}
      title="Your machine"
      description="Scan this machine so model recommendations reflect what it can actually run. Saving keeps the profile for future ratings."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={busy !== null}
          onClick={() => void scan()}
        >
          <ScanSearch aria-hidden="true" />
          {busy === "scan" ? "Scanning…" : "Scan hardware"}
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={!profile || busy !== null}
          onClick={() => void save()}
        >
          <Save aria-hidden="true" />
          {busy === "save" ? "Saving…" : "Save profile"}
        </Button>
        {data?.saved && (
          <span className="text-xs text-muted-foreground">
            Saved profile from{" "}
            {new Date(data.saved.scanned_at).toLocaleString()}
          </span>
        )}
      </div>
      {profile && (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <InfoRow label="CPU" value={profile.cpu_model || "Unknown"} />
            <InfoRow label="Cores" value={profile.cpu_cores.toString()} mono />
            <InfoRow
              label="RAM"
              value={profile.ram_gb > 0 ? `${profile.ram_gb} GB` : "Unknown"}
              mono
            />
            <InfoRow
              label="GPU"
              value={gpuLabel(profile.gpu_name, profile.vram_gb)}
            />
            <InfoRow label="OS" value={profile.os || "Unknown"} />
          </dl>
          {profile.unified_memory && (
            <p className="text-xs text-muted-foreground">
              Unified memory: the GPU shares system RAM, so models draw from the
              full {profile.ram_gb} GB.
            </p>
          )}
        </>
      )}
      {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}
    </SettingsGroup>
  );
}

function gpuLabel(name: string | null, vramGb: number | null): string {
  if (!name) return "None detected";
  return vramGb ? `${name} · ${vramGb} GB VRAM` : name;
}

function InfoRow(props: {
  label: string;
  value: string;
  mono?: boolean;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={cn(
          "text-sm font-medium break-words text-foreground",
          props.mono && "font-mono",
        )}
      >
        {props.value}
      </dd>
    </div>
  );
}

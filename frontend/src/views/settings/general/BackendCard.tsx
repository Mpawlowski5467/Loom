import { Clipboard } from "lucide-react";
import type { HealthResponse } from "@/api/diagnostics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsCard } from "../kit/SettingsCard";

interface BackendCardProps {
  health: HealthResponse | null;
  vaultPath: string | undefined;
  logPath: string | undefined;
  /** Copy the vault path; null until diagnostics have loaded. */
  onCopyPath: (() => void) | null;
}

const LABEL = "text-xs font-medium text-muted-foreground";

/** Backend readiness with per-component status, plus the vault and log paths. */
export function BackendCard({
  health,
  vaultPath,
  logPath,
  onCopyPath,
}: BackendCardProps) {
  return (
    <SettingsCard className="grid gap-4 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>Backend</span>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 font-mono text-xs font-medium",
              health?.ok
                ? "bg-ok text-ok-foreground"
                : "bg-warning text-warning-foreground",
            )}
          >
            {health?.ok ? "Ready" : "Limited"}
          </span>
        </div>
        {health && (
          <ul className="flex flex-col gap-1.5">
            {Object.entries(health.components).map(([name, c]) => (
              <li key={name} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    c.ready ? "bg-ok-foreground" : "bg-warning-foreground",
                  )}
                />
                <span className="text-secondary-foreground capitalize">
                  {name}
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
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
      <div className="flex min-w-0 flex-col gap-3">
        <PathLine label="Vault path" value={vaultPath} />
        <PathLine label="Logs" value={logPath} />
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onCopyPath?.()}
          disabled={!onCopyPath}
        >
          <Clipboard aria-hidden="true" />
          Copy path
        </Button>
      </div>
    </SettingsCard>
  );
}

function PathLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <span className="font-mono text-xs break-all text-foreground">
        {value ?? "Loading…"}
      </span>
    </div>
  );
}

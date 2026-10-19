import type { VaultBackupStatus } from "@/api/vault";
import { cn } from "@/lib/utils";

/** When the vault was last exported, flagged when a backup is due. */
export function BackupStatusLine({
  status,
}: {
  status: VaultBackupStatus | undefined;
}) {
  if (!status?.last_exported_at) {
    return (
      <p className="font-mono text-xs text-warning-foreground">
        No export recorded — backup recommended
      </p>
    );
  }
  const exported = new Date(status.last_exported_at).toLocaleString();
  const size = status.last_export_size
    ? ` · ${(status.last_export_size / 1024 / 1024).toFixed(1)} MB`
    : "";
  return (
    <p
      className={cn(
        "font-mono text-xs",
        status.reminder_due
          ? "text-warning-foreground"
          : "text-secondary-foreground",
      )}
    >
      Last export: {exported}
      {size}
      {status.reminder_due ? " · refresh recommended" : ""}
    </p>
  );
}

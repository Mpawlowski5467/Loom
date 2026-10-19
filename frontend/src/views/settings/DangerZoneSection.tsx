import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Archive, Download, RotateCcw, Skull, Trash2 } from "lucide-react";
import { resetOnboarding } from "@/api/onboarding";
import { archiveVault, hardDeleteVault, vaultExportUrl } from "@/api/vault";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { TypedConfirmModal } from "./TypedConfirmModal";
import { dangerActionConfig, type DangerAction } from "./vault/dangerActions";

/** Resets and destructive vault actions, each behind a typed confirmation. */
export function DangerZoneSection(): ReactNode {
  const { config, refreshConfig } = useApp();
  const [action, setAction] = useState<DangerAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const vaultName = config?.active_vault ?? "";

  // Success status that fades after a few seconds so it isn't mistaken for a
  // persistent state. The modal owns error display, not this.
  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  };

  const exportVault = () => {
    if (!vaultName) return;
    const link = document.createElement("a");
    link.href = vaultExportUrl(vaultName);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    flash(`Exporting ${vaultName}…`);
  };

  // Errors are intentionally NOT caught here: they propagate to
  // TypedConfirmModal, which shows them inline and keeps itself open so the
  // user can retry without re-typing the confirmation phrase.
  const confirm = async () => {
    if (action === "reset") {
      await resetOnboarding();
      await refreshConfig();
      flash("Onboarding reset.");
    }
    if (action === "cache") {
      window.localStorage.clear();
      window.location.reload();
    }
    if (action === "archive" && vaultName) {
      const result = await archiveVault(vaultName);
      await refreshConfig();
      flash(`Archived ${result.archived_name}.`);
    }
    if (action === "delete" && vaultName) {
      await hardDeleteVault(vaultName);
      await refreshConfig();
      flash(`Permanently deleted ${vaultName}.`);
    }
  };

  const modal = action ? dangerActionConfig(action, vaultName) : null;
  const noVault = "No vault loaded.";

  return (
    <SettingsGroup title="Danger Zone">
      <div className="flex flex-col divide-y divide-border rounded-lg border border-danger-foreground/40 bg-card">
        <DangerRow
          icon={<RotateCcw />}
          title="Reset onboarding"
          body="Show the first-run wizard again without deleting vault data."
          onClick={() => setAction("reset")}
        />
        <DangerRow
          icon={<Trash2 />}
          title="Clear local cache"
          body="Clear browser-local Loom state and reload the app."
          onClick={() => setAction("cache")}
        />
        <DangerRow
          icon={<Download />}
          title="Export vault"
          body={
            vaultName
              ? `Download a restorable tarball of ${vaultName}.`
              : noVault
          }
          disabled={!vaultName}
          onClick={exportVault}
        />
        <DangerRow
          icon={<Archive />}
          title="Archive current vault"
          body={vaultName ? `Archive ${vaultName} and switch vaults.` : noVault}
          disabled={!vaultName}
          onClick={() => setAction("archive")}
        />
        <DangerRow
          icon={<Skull />}
          title="Permanently delete vault"
          body={
            vaultName
              ? `Erase ${vaultName} from disk. Nothing is recoverable — export first.`
              : noVault
          }
          disabled={!vaultName}
          onClick={() => setAction("delete")}
        />
      </div>
      {message && <StatusLine>{message}</StatusLine>}
      {modal && (
        <TypedConfirmModal
          phrase={modal.phrase}
          body={modal.body}
          destructiveLabel={modal.label}
          onConfirm={confirm}
          onClose={() => setAction(null)}
        />
      )}
    </SettingsGroup>
  );
}

function DangerRow(props: {
  icon: ReactNode;
  title: string;
  body: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  const bodyId = useId();
  return (
    <article className="flex flex-wrap items-center gap-3 p-4 text-sm">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-danger-foreground [&_svg]:size-4"
      >
        {props.icon}
      </span>
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <h3 className="font-medium text-foreground">{props.title}</h3>
        <p id={bodyId} className="text-muted-foreground">
          {props.body}
        </p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        className="border border-danger-foreground/40"
        aria-describedby={bodyId}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.title}
      </Button>
    </article>
  );
}

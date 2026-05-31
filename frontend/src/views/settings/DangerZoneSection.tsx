import { useState } from "react";
import type { ReactNode } from "react";
import { Archive, Download, RotateCcw, Skull, Trash2 } from "lucide-react";
import { resetOnboarding } from "../../api/onboarding";
import { archiveVault, hardDeleteVault, vaultExportUrl } from "../../api/vault";
import { useApp } from "../../context/app-ctx";
import { TypedConfirmModal } from "./TypedConfirmModal";

type Action = "reset" | "cache" | "archive" | "delete";

export function DangerZoneSection(): ReactNode {
  const { config, refreshConfig } = useApp();
  const [action, setAction] = useState<Action | null>(null);
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

  const modal = action ? actionConfig(action, vaultName) : null;

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Danger</div>
      <h1 className="settings-title">Danger Zone</h1>
      <div className="settings-danger-list">
        <DangerAction
          icon={<RotateCcw size={15} aria-hidden="true" />}
          title="Reset onboarding"
          body="Show the first-run wizard again without deleting vault data."
          onClick={() => setAction("reset")}
        />
        <DangerAction
          icon={<Trash2 size={15} aria-hidden="true" />}
          title="Clear local cache"
          body="Clear browser-local Loom state and reload the app."
          onClick={() => setAction("cache")}
        />
        <DangerAction
          icon={<Download size={15} aria-hidden="true" />}
          title="Export vault"
          body={
            vaultName
              ? `Download a restorable tarball of ${vaultName}.`
              : "No vault loaded."
          }
          disabled={!vaultName}
          onClick={exportVault}
        />
        <DangerAction
          icon={<Archive size={15} aria-hidden="true" />}
          title="Archive current vault"
          body={
            vaultName
              ? `Archive ${vaultName} and switch vaults.`
              : "No vault loaded."
          }
          disabled={!vaultName}
          onClick={() => setAction("archive")}
        />
        <DangerAction
          icon={<Skull size={15} aria-hidden="true" />}
          title="Permanently delete vault"
          body={
            vaultName
              ? `Erase ${vaultName} from disk. Nothing is recoverable — export first.`
              : "No vault loaded."
          }
          disabled={!vaultName}
          onClick={() => setAction("delete")}
        />
      </div>
      {message && <div className="settings-inline-status">{message}</div>}
      {modal && (
        <TypedConfirmModal
          phrase={modal.phrase}
          body={modal.body}
          destructiveLabel={modal.label}
          onConfirm={confirm}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}

function DangerAction(props: {
  icon: ReactNode;
  title: string;
  body: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <article className="settings-danger-card">
      <div className="settings-danger-icon">{props.icon}</div>
      <div>
        <h2>{props.title}</h2>
        <p>{props.body}</p>
      </div>
      <button
        className="btn btn-md btn-amber"
        type="button"
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.title}
      </button>
    </article>
  );
}

function actionConfig(action: Action, vaultName: string) {
  if (action === "reset") {
    return {
      phrase: "RESET ONBOARDING",
      label: "Reset onboarding",
      body: "Existing vaults and provider settings are kept intact.",
    };
  }
  if (action === "cache") {
    return {
      phrase: "CLEAR CACHE",
      label: "Clear cache",
      body: "This clears local browser storage and reloads Loom.",
    };
  }
  if (action === "delete") {
    return {
      phrase: vaultName,
      label: "Permanently delete",
      body:
        `This permanently erases ${vaultName} from disk. ` +
        "Nothing is recoverable. Type the vault name to confirm.",
    };
  }
  return {
    phrase: `ARCHIVE ${vaultName}`,
    label: "Archive vault",
    body: "The vault folder moves to an archived directory.",
  };
}

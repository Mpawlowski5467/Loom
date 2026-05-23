import { useState } from "react";
import type { ReactNode } from "react";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { resetOnboarding } from "../../api/onboarding";
import { archiveVault } from "../../api/vault";
import { useApp } from "../../context/app-ctx";
import { TypedConfirmModal } from "./TypedConfirmModal";

type Action = "reset" | "cache" | "archive";

export function DangerZoneSection(): ReactNode {
  const { config, refreshConfig } = useApp();
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const vaultName = config?.active_vault ?? "";

  const confirm = async () => {
    if (action === "reset") {
      await resetOnboarding();
      await refreshConfig();
      setMessage("Onboarding reset.");
    }
    if (action === "cache") {
      window.localStorage.clear();
      window.location.reload();
    }
    if (action === "archive" && vaultName) {
      const result = await archiveVault(vaultName);
      await refreshConfig();
      setMessage(`Archived ${result.archived_name}.`);
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
  return {
    phrase: `ARCHIVE ${vaultName}`,
    label: "Archive vault",
    body: "The vault folder moves to an archived directory.",
  };
}

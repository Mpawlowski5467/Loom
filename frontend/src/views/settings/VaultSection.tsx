import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Download, Eye, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import {
  archiveVault,
  createVault,
  listVaults,
  renameVault,
  revealVault,
  setActiveVault,
  vaultExportUrl,
} from "../../api/vault";
import type { VaultInfo } from "../../api/types";
import { useApp } from "../../context/app-ctx";

// Mirrors backend/core/vault.py _NAME_RE: must start alphanumeric, then
// letters/digits/dash/underscore, max 64 chars total.
const VAULT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function VaultSection(): ReactNode {
  const { refreshConfig } = useApp();
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [active, setActive] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const load = async () => {
    const result = await listVaults();
    setVaults(result.vaults);
    setActive(result.active);
  };

  useEffect(() => {
    void load().catch((err) => {
      setMessage(err instanceof Error ? err.message : "Vault load failed");
    });
  }, []);

  const switchVault = async (next: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await setActiveVault(next);
      await refreshConfig();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Vault switch failed");
    } finally {
      setBusy(false);
    }
  };

  const addVault = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await createVault({ name: trimmed });
      await setActiveVault(trimmed);
      await refreshConfig();
      await load();
      setName("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Vault create failed");
    } finally {
      setBusy(false);
    }
  };

  const reveal = async (vault: string) => {
    setMessage(null);
    try {
      await revealVault(vault);
      setMessage("Vault folder opened.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Reveal failed");
    }
  };

  const exportVault = (vault: string) => {
    setMessage(null);
    const link = document.createElement("a");
    link.href = vaultExportUrl(vault);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setMessage(`Exporting ${vault}…`);
  };

  const beginRename = (vault: VaultInfo) => {
    setRenaming(vault.name);
    setRenameDraft(vault.name);
    setRenameError(null);
  };

  const submitRename = async (oldName: string) => {
    const next = renameDraft.trim();
    if (!next) {
      setRenameError("Name required");
      return;
    }
    if (!VAULT_NAME_RE.test(next)) {
      setRenameError(
        "Start with a letter or digit; dashes and underscores allowed (max 64).",
      );
      return;
    }
    if (next === oldName) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      await renameVault(oldName, next);
      await refreshConfig();
      await load();
      setRenaming(null);
      setMessage(`Renamed ${oldName} → ${next}`);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteVault = async (vault: string) => {
    const typed = window.prompt(
      `Archive vault "${vault}"? This moves it to ~/.loom/vaults/.archive/. ` +
        `Type the vault name to confirm:`,
    );
    if (typed === null) return;
    if (typed !== vault) {
      setMessage("Vault name did not match — not archived.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await archiveVault(vault);
      await refreshConfig();
      await load();
      setMessage(`Archived ${vault}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Vault</div>
      <h1 className="settings-title">Vaults</h1>
      <div className="settings-create-row">
        <input
          className="input"
          type="text"
          value={name}
          placeholder="new-vault"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addVault();
          }}
        />
        <button
          className="btn btn-md btn-active"
          type="button"
          onClick={() => void addVault()}
          disabled={busy || !name.trim()}
        >
          <Plus size={14} aria-hidden="true" />
          Create
        </button>
      </div>
      <div className="settings-vault-list">
        {vaults.map((vault) => {
          const isActive = vault.name === active;
          const isRenaming = renaming === vault.name;
          return (
            <article key={vault.name} className="settings-vault-card">
              <div>
                {isRenaming ? (
                  <div className="settings-vault-rename">
                    <input
                      className="input"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          void submitRename(vault.name);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      aria-invalid={renameError !== null}
                    />
                    {renameError && (
                      <div className="tree-new-folder-error">
                        {renameError}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="settings-vault-name">
                      <FolderOpen size={15} aria-hidden="true" />
                      {vault.name}
                    </div>
                    <div className="settings-vault-path">{vault.path}</div>
                  </>
                )}
              </div>
              <div className="settings-vault-actions">
                {isRenaming ? (
                  <>
                    <button
                      className="btn btn-md btn-active"
                      type="button"
                      onClick={() => void submitRename(vault.name)}
                      disabled={busy}
                    >
                      Save
                    </button>
                    <button
                      className="btn btn-md"
                      type="button"
                      onClick={() => setRenaming(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-md"
                      type="button"
                      onClick={() => void switchVault(vault.name)}
                      disabled={busy || isActive}
                    >
                      {isActive ? "Active" : "Switch"}
                    </button>
                    <button
                      className="btn btn-md"
                      type="button"
                      title="Linux folder reveal depends on your desktop environment."
                      onClick={() => void reveal(vault.name)}
                    >
                      <Eye size={14} aria-hidden="true" />
                      Reveal
                    </button>
                    <button
                      className="btn btn-md"
                      type="button"
                      title="Download a restorable tarball of this vault."
                      onClick={() => exportVault(vault.name)}
                    >
                      <Download size={14} aria-hidden="true" />
                      Export
                    </button>
                    <button
                      className="btn btn-md"
                      type="button"
                      onClick={() => beginRename(vault)}
                      disabled={busy}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      Rename
                    </button>
                    <button
                      className="btn btn-md"
                      type="button"
                      onClick={() => void deleteVault(vault.name)}
                      disabled={busy || isActive}
                      title={
                        isActive
                          ? "Switch to another vault first"
                          : "Archive vault"
                      }
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {message && <div className="settings-inline-status">{message}</div>}
    </div>
  );
}

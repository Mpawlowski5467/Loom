import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Eye, FolderOpen, Plus } from "lucide-react";
import {
  createVault,
  listVaults,
  revealVault,
  setActiveVault,
} from "../../api/vault";
import type { VaultInfo } from "../../api/types";
import { useApp } from "../../context/app-ctx";

export function VaultSection(): ReactNode {
  const { refreshConfig } = useApp();
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [active, setActive] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        {vaults.map((vault) => (
          <article key={vault.name} className="settings-vault-card">
            <div>
              <div className="settings-vault-name">
                <FolderOpen size={15} aria-hidden="true" />
                {vault.name}
              </div>
              <div className="settings-vault-path">{vault.path}</div>
            </div>
            <div className="settings-vault-actions">
              <button
                className="btn btn-md"
                type="button"
                onClick={() => void switchVault(vault.name)}
                disabled={busy || vault.name === active}
              >
                {vault.name === active ? "Active" : "Switch"}
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
            </div>
          </article>
        ))}
      </div>
      {message && <div className="settings-inline-status">{message}</div>}
    </div>
  );
}

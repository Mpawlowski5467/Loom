import { useEffect, useState } from "react";
import { describeApiError } from "@/api/client";
import {
  archiveVault,
  createVault,
  getVaultBackupStatus,
  listVaults,
  revealVault,
  setActiveVault,
  vaultExportUrl,
  type VaultBackupStatus,
} from "@/api/vault";
import type { VaultInfo } from "@/api/types";
import { useApp } from "@/context/app-ctx";

const errorText = (err: unknown, fallback: string) =>
  describeApiError(err, fallback);

/** The vault list with backup status, and the actions on it. */
export function useVaults() {
  const { refreshConfig } = useApp();
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [active, setActive] = useState("");
  const [backupStatus, setBackupStatus] = useState<
    Record<string, VaultBackupStatus>
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const result = await listVaults();
    setVaults(result.vaults);
    setActive(result.active);
    const entries = await Promise.all(
      result.vaults.map(async (vault) => {
        try {
          return [vault.name, await getVaultBackupStatus(vault.name)] as const;
        } catch {
          return null;
        }
      }),
    );
    setBackupStatus(
      Object.fromEntries(entries.filter((entry) => entry !== null)),
    );
  };

  useEffect(() => {
    void load().catch((err) => {
      setMessage(errorText(err, "Vault load failed"));
    });
  }, []);

  /** Run a busy, message-clearing vault change; reports failures inline. */
  const change = async (fallback: string, action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      return true;
    } catch (err) {
      setMessage(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const switchVault = (next: string) =>
    change("Vault switch failed", async () => {
      await setActiveVault(next);
      await refreshConfig();
      await load();
    });

  /** Create and activate a vault; resolves true when it worked. */
  const addVault = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    return change("Vault create failed", async () => {
      await createVault({ name: trimmed });
      await setActiveVault(trimmed);
      await refreshConfig();
      await load();
    });
  };

  const reveal = async (vault: string) => {
    setMessage(null);
    try {
      await revealVault(vault);
      setMessage("Vault folder opened.");
    } catch (err) {
      setMessage(errorText(err, "Reveal failed"));
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
    setBackupStatus((current) => ({
      ...current,
      [vault]: {
        vault,
        last_exported_at: new Date().toISOString(),
        last_export_size: null,
        reminder_due: false,
      },
    }));
    setMessage(`Exporting ${vault}…`);
  };

  /** Archive a vault (the caller has had the user type its name). */
  const deleteVault = async (vault: string) => {
    await change("Archive failed", async () => {
      await archiveVault(vault);
      await refreshConfig();
      await load();
      setMessage(`Archived ${vault}.`);
    });
  };

  return {
    vaults,
    active,
    backupStatus,
    busy,
    setBusy,
    message,
    setMessage,
    load,
    switchVault,
    addVault,
    reveal,
    exportVault,
    deleteVault,
  };
}

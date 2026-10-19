import { useState } from "react";
import { renameVault } from "@/api/vault";
import type { VaultInfo } from "@/api/types";
import { useApp } from "@/context/app-ctx";
import { VAULT_NAME_RE } from "./vaultName";
import { describeApiError } from "@/api/client";

interface VaultRenameDeps {
  load: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string | null) => void;
}

/** Inline rename for one vault at a time, validated like the backend. */
export function useVaultRename({ load, setBusy, setMessage }: VaultRenameDeps) {
  const { refreshConfig } = useApp();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const begin = (vault: VaultInfo) => {
    setRenaming(vault.name);
    setDraft(vault.name);
    setError(null);
  };

  const cancel = () => setRenaming(null);

  const submit = async (oldName: string) => {
    const next = draft.trim();
    if (!next) {
      setError("Name required");
      return;
    }
    if (!VAULT_NAME_RE.test(next)) {
      setError(
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
      setError(describeApiError(err, "Rename failed"));
    } finally {
      setBusy(false);
    }
  };

  return { renaming, draft, setDraft, error, begin, cancel, submit };
}

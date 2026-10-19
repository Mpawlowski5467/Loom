import { useState } from "react";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TypedConfirmModal } from "./TypedConfirmModal";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { useVaultRename } from "./vault/useVaultRename";
import { useVaults } from "./vault/useVaults";
import { VaultCard } from "./vault/VaultCard";
import { VaultImport } from "./VaultImport";

/** Settings → Vault: create, switch, rename, export and archive vaults. */
export function VaultSection(): ReactNode {
  const v = useVaults();
  const rename = useVaultRename(v);
  const [name, setName] = useState("");
  const [archiving, setArchiving] = useState<string | null>(null);

  const create = async () => {
    if (await v.addVault(name)) setName("");
  };

  return (
    <>
      <SettingsGroup level={1} title="Vaults">
        <div className="flex gap-2">
          <Input
            aria-label="New vault name"
            className="h-8"
            type="text"
            value={name}
            placeholder="new-vault"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
          <Button
            size="sm"
            onClick={() => void create()}
            disabled={v.busy || !name.trim()}
          >
            <Plus aria-hidden="true" />
            Create
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {v.vaults.map((vault) => (
            <VaultCard
              key={vault.name}
              vault={vault}
              isActive={vault.name === v.active}
              backup={v.backupStatus[vault.name]}
              busy={v.busy}
              rename={
                rename.renaming === vault.name
                  ? {
                      draft: rename.draft,
                      error: rename.error,
                      onDraftChange: rename.setDraft,
                      onSubmit: () => void rename.submit(vault.name),
                      onCancel: rename.cancel,
                    }
                  : null
              }
              onSwitch={() => void v.switchVault(vault.name)}
              onReveal={() => void v.reveal(vault.name)}
              onExport={() => v.exportVault(vault.name)}
              onRename={() => rename.begin(vault)}
              onDelete={() => setArchiving(vault.name)}
            />
          ))}
        </div>
        {v.message && <StatusLine>{v.message}</StatusLine>}
      </SettingsGroup>
      {archiving && (
        <TypedConfirmModal
          phrase={archiving}
          body={`Archive the vault "${archiving}"? It moves to ~/.loom/vaults/.archive/. Type the vault name to confirm.`}
          destructiveLabel="Archive vault"
          onConfirm={() => v.deleteVault(archiving)}
          onClose={() => setArchiving(null)}
        />
      )}
      <VaultImport onImported={v.load} />
    </>
  );
}

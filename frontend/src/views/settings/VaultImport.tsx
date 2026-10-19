import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Upload } from "lucide-react";
import { ApiError, describeApiError } from "@/api/client";
import { importVault } from "@/api/vault";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { VAULT_NAME_RE } from "./vault/vaultName";

interface VaultImportProps {
  /** Called after a successful import so the caller can refresh its list. */
  onImported: () => void | Promise<void>;
}

/** Derive a sensible vault name from an export filename like
 * ``demo-export-20260101T000000Z.tar.gz`` → ``demo``. */
function nameFromFile(filename: string): string {
  return filename
    .replace(/\.tar\.gz$/i, "")
    .replace(/\.t?gz$/i, "")
    .replace(/-export-.*$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 64);
}

/**
 * "Import a vault": pick an exported ``.tar.gz`` backup, choose a
 * destination name, and restore it through the existing import endpoint. A
 * name collision asks for an explicit overwrite confirmation rather than
 * silently clobbering an existing vault.
 */
export function VaultImport({ onImported }: VaultImportProps): ReactNode {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** The name that collided, while the overwrite dialog is open. */
  const [collision, setCollision] = useState<string | null>(null);

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setMessage(null);
    if (picked && !name.trim()) {
      const derived = nameFromFile(picked.name);
      if (derived) setName(derived);
    }
    // Reset so re-picking the same file still fires onChange.
    e.target.value = "";
  };

  const run = async (overwrite: boolean) => {
    await importVault(name.trim(), file as File, overwrite);
    setFile(null);
    await onImported();
  };

  const doImport = async () => {
    const trimmed = name.trim();
    if (!trimmed || !file) return;
    if (!VAULT_NAME_RE.test(trimmed)) {
      setMessage(
        "Invalid name: start with a letter or digit; dashes and underscores allowed (max 64).",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await run(false);
      setMessage(`Imported "${trimmed}". Switch to it from the list above.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setCollision(trimmed);
      else {
        setMessage(describeApiError(err, "Import failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup
      title="Import a vault"
      description={
        <>
          Restore a vault from an exported{" "}
          <code className="font-mono text-xs">.tar.gz</code> backup.
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Imported vault name"
          className="h-8 min-w-0 flex-1 basis-40"
          type="text"
          value={name}
          placeholder="vault name"
          onChange={(e) => setName(e.target.value)}
        />
        {/* The file input stays focusable (sr-only, not hidden) so the
            picker opens from the keyboard; the label shows its focus ring. */}
        <label
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "relative cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring",
          )}
        >
          <Upload aria-hidden="true" />
          {file ? "Change file" : "Choose file"}
          <input
            type="file"
            accept=".gz,.tgz,.tar.gz,application/gzip"
            className="sr-only"
            onChange={pickFile}
          />
        </label>
        <Button
          size="sm"
          onClick={() => void doImport()}
          disabled={busy || !name.trim() || !file}
        >
          Import
        </Button>
      </div>
      {file && (
        <p className="font-mono text-xs break-all text-muted-foreground">
          Selected: {file.name}
        </p>
      )}
      {message && <StatusLine>{message}</StatusLine>}
      {collision && (
        <ConfirmModal
          title={`Replace the vault "${collision}"?`}
          body="A vault with this name already exists. Replacing it with this backup can't be undone."
          confirmLabel="Replace vault"
          onConfirm={async () => {
            await run(true);
            setMessage(
              `Imported "${collision}" (replaced the existing vault).`,
            );
          }}
          onClose={() => {
            setCollision(null);
            setMessage((m) => m ?? "Import cancelled.");
          }}
        />
      )}
    </SettingsGroup>
  );
}

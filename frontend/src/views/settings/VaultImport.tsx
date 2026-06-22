import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Upload } from "lucide-react";
import { ApiError } from "../../api/client";
import { importVault } from "../../api/vault";

interface VaultImportProps {
  /** Called after a successful import so the caller can refresh its list. */
  onImported: () => void | Promise<void>;
}

// Mirrors backend/core/vault.py _NAME_RE.
const VAULT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

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
 * "Import a vault" card: pick an exported ``.tar.gz`` backup, choose a
 * destination name, and restore it through the existing import endpoint. A
 * name collision prompts for an explicit overwrite confirmation rather than
 * silently clobbering an existing vault.
 */
export function VaultImport({ onImported }: VaultImportProps): ReactNode {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      if (err instanceof ApiError && err.status === 409) {
        const ok = window.confirm(
          `A vault named "${trimmed}" already exists. Replace it with this backup? ` +
            `This cannot be undone.`,
        );
        if (!ok) {
          setMessage("Import cancelled.");
          return;
        }
        try {
          await run(true);
          setMessage(`Imported "${trimmed}" (replaced the existing vault).`);
        } catch (err2) {
          setMessage(err2 instanceof Error ? err2.message : "Import failed");
        }
      } else {
        setMessage(err instanceof Error ? err.message : "Import failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-import">
      <div className="settings-subhead">Import a vault</div>
      <p className="settings-copy settings-copy-tight">
        Restore a vault from an exported <span className="mono">.tar.gz</span>{" "}
        backup.
      </p>
      <div className="settings-create-row">
        <input
          className="input"
          type="text"
          value={name}
          placeholder="vault name"
          onChange={(e) => setName(e.target.value)}
        />
        <label className="btn btn-md">
          <Upload size={14} aria-hidden="true" />
          {file ? "Change file" : "Choose file"}
          <input
            type="file"
            accept=".gz,.tgz,.tar.gz,application/gzip"
            hidden
            onChange={pickFile}
          />
        </label>
        <button
          className="btn btn-md btn-active"
          type="button"
          onClick={() => void doImport()}
          disabled={busy || !name.trim() || !file}
        >
          Import
        </button>
      </div>
      {file && (
        <div className="settings-vault-path">Selected: {file.name}</div>
      )}
      {message && <div className="settings-inline-status">{message}</div>}
    </div>
  );
}

import { useId } from "react";
import {
  CircleCheck,
  Download,
  Eye,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import type { VaultInfo } from "@/api/types";
import type { VaultBackupStatus } from "@/api/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BackupStatusLine } from "./BackupStatusLine";
import { ListCard } from "./ListCard";

/** The inline rename form's state, when this card is being renamed. */
export interface VaultRenameState {
  draft: string;
  error: string | null;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

interface VaultCardProps {
  vault: VaultInfo;
  isActive: boolean;
  backup: VaultBackupStatus | undefined;
  busy: boolean;
  rename: VaultRenameState | null;
  onSwitch: () => void;
  onReveal: () => void;
  onExport: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** One vault: name, path and backup status, or its rename form; actions. */
export function VaultCard(props: VaultCardProps) {
  const { vault, isActive, rename } = props;
  return (
    <ListCard className={cn(isActive && "border-border-strong")}>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        {rename ? (
          <RenameField name={vault.name} rename={rename} />
        ) : (
          <>
            <p className="flex items-center gap-2 font-medium text-foreground">
              <FolderOpen
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              {vault.name}
            </p>
            <p className="font-mono text-xs break-all text-muted-foreground">
              {vault.path}
            </p>
            <BackupStatusLine status={props.backup} />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {rename ? (
          <>
            <Button size="sm" onClick={rename.onSubmit} disabled={props.busy}>
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={rename.onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <VaultActions {...props} />
        )}
      </div>
    </ListCard>
  );
}

function RenameField({
  name,
  rename,
}: {
  name: string;
  rename: VaultRenameState;
}) {
  const errorId = useId();
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={`New name for ${name}`}
        className="h-8"
        value={rename.draft}
        autoFocus
        onChange={(e) => rename.onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") rename.onSubmit();
          if (e.key === "Escape") rename.onCancel();
        }}
        aria-invalid={rename.error !== null}
        aria-describedby={rename.error ? errorId : undefined}
      />
      {rename.error && (
        <p id={errorId} className="text-xs text-danger-foreground">
          {rename.error}
        </p>
      )}
    </div>
  );
}

function VaultActions(p: VaultCardProps) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={p.onSwitch}
        disabled={p.busy || p.isActive}
      >
        {p.isActive && <CircleCheck aria-hidden="true" />}
        {p.isActive ? "Active" : "Switch"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        title="Linux folder reveal depends on your desktop environment."
        onClick={p.onReveal}
      >
        <Eye aria-hidden="true" />
        Reveal
      </Button>
      <Button
        variant="outline"
        size="sm"
        title="Download a restorable tarball of this vault."
        onClick={p.onExport}
      >
        <Download aria-hidden="true" />
        Export
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={p.onRename}
        disabled={p.busy}
      >
        <Pencil aria-hidden="true" />
        Rename
      </Button>
      <Button
        variant="destructive"
        size="sm"
        className="border border-border"
        onClick={p.onDelete}
        disabled={p.busy || p.isActive}
        title={p.isActive ? "Switch to another vault first" : "Archive vault"}
      >
        <Trash2 aria-hidden="true" />
        Delete
      </Button>
    </>
  );
}

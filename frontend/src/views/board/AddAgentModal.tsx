import { useId, useState } from "react";
import {
  createCustomAgent,
  updateCustomAgent,
  type AgentRegistryRecord,
} from "@/api/agentsRegistry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelOverrideField } from "./ModelOverrideField";
import { PromptField } from "./PromptField";

interface Props {
  existing?: AgentRegistryRecord;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/** Create or edit a custom Shuttle agent. ⌘↵ saves. */
export function AddAgentModal({ existing, onClose, onSaved }: Props) {
  const ids = { name: useId(), role: useId() };
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState(existing?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(
    existing?.system_prompt ?? "",
  );
  const [provider, setProvider] = useState(existing?.provider ?? "");
  const [chatModel, setChatModel] = useState(existing?.chat_model ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        role: role.trim(),
        // Icons aren't shown any more (avatars use initials); keep theirs.
        icon: existing?.icon || "✦",
        system_prompt: systemPrompt,
        // Empty strings mean "use the vault default" on the backend.
        provider: provider.trim(),
        chat_model: chatModel.trim(),
      };
      if (existing) await updateCustomAgent(existing.id, payload);
      else await createCustomAgent(payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit agent" : "Add agent"}</DialogTitle>
          <DialogDescription>
            Custom agents live in your vault. Run one and it gathers vault
            context, calls your chat model with the instructions below, and
            writes a capture to your Inbox for triage.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.name}>Name</Label>
          <Input
            id={ids.name}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.role}>Role</Label>
          <Input
            id={ids.role}
            placeholder="What does this agent do?"
            aria-describedby={`${ids.role}-hint`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            onKeyDown={onKey}
          />
          <p id={`${ids.role}-hint`} className="text-xs text-muted-foreground">
            One line for its card, e.g. "digests my reading captures".
          </p>
        </div>
        <PromptField
          value={systemPrompt}
          onChange={setSystemPrompt}
          onKeyDown={onKey}
        />
        <ModelOverrideField
          provider={provider}
          chatModel={chatModel}
          onProviderChange={(next) => {
            setProvider(next);
            // A different provider invalidates the previous model choice.
            setChatModel("");
          }}
          onModelChange={setChatModel}
        />
        {error && (
          <p role="status" className="text-sm text-danger-foreground">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? "Saving…" : existing ? "Save" : "Add agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

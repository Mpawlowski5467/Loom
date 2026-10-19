import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROVIDERS,
  PROVIDER_BY_NAME,
  type ProviderName,
} from "../settings/providerModels";

interface ModelOverrideFieldProps {
  provider: string;
  chatModel: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
}

/**
 * Optional per-agent chat model, collapsed by default. Empty values mean
 * "use the vault default"; known models are suggested but any name works.
 */
export function ModelOverrideField(p: ModelOverrideFieldProps) {
  const ids = { provider: useId(), model: useId(), list: useId() };
  const [open, setOpen] = useState(Boolean(p.provider || p.chatModel));
  const meta = PROVIDER_BY_NAME.get(p.provider as ProviderName);
  const summary =
    p.provider || p.chatModel
      ? `${meta?.label ?? p.provider ?? "default provider"} · ${p.chatModel || "default model"}`
      : "vault default";
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/model flex flex-col gap-3"
    >
      <CollapsibleTrigger className="flex items-center gap-2 rounded-sm text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-data-[state=open]/model:rotate-90"
        />
        Model
        <span className="font-mono text-xs font-normal text-muted-foreground">
          {summary}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.provider}>Provider</Label>
          <select
            id={ids.provider}
            value={p.provider}
            onChange={(e) => p.onProviderChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <option value="">vault default</option>
            {PROVIDERS.map((x) => (
              <option key={x.name} value={x.name}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.model}>Chat model</Label>
          <Input
            id={ids.model}
            list={ids.list}
            value={p.chatModel}
            placeholder="model name"
            onChange={(e) => p.onModelChange(e.target.value)}
            className="font-mono text-xs"
          />
          <datalist id={ids.list}>
            {(meta?.chatModels ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

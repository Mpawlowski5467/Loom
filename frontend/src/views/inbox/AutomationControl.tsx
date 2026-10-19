import { Settings2 } from "lucide-react";
import type { CaptureProcessingMode } from "@/api/captures";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { usePolicy } from "./usePolicy";

const MODE_LABEL: Record<CaptureProcessingMode, string> = {
  manual: "Manual",
  trusted: "Selected sources",
  all: "All captures",
};

interface AutomationControlProps {
  policy: ReturnType<typeof usePolicy>;
  demoMode: boolean;
}

/** Auto-process policy: manual review, trusted sources, or everything. */
export function AutomationControl({
  policy: p,
  demoMode,
}: AutomationControlProps) {
  const state = demoMode
    ? "demo only"
    : !p.loaded
      ? "loading…"
      : p.saving
        ? "saving…"
        : p.policy.mode === "manual"
          ? "review first"
          : "jobs enabled";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          <Settings2 aria-hidden="true" />
          Auto-process: {MODE_LABEL[p.policy.mode]}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 flex-col gap-3"
        aria-label="Inbox automation"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="inbox-processing-policy">Auto-process</Label>
          <div className="flex items-center gap-2">
            <select
              id="inbox-processing-policy"
              value={p.policy.mode}
              disabled={demoMode || !p.loaded || p.saving}
              onChange={(e) =>
                void p.save({ mode: e.target.value as CaptureProcessingMode })
              }
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <option value="manual">Manual</option>
              <option value="trusted">Selected sources</option>
              <option value="all">All captures</option>
            </select>
            <span role="status" className="text-xs text-muted-foreground">
              {state}
            </span>
          </div>
        </div>
        {p.policy.mode === "trusted" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="inbox-trusted-source-list">
              Auto-process source names
            </Label>
            <div className="flex gap-2">
              <Input
                id="inbox-trusted-source-list"
                value={p.trustedDraft}
                onChange={(e) => p.setTrustedDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    p.saveTrusted();
                  }
                }}
                placeholder="bridge:gmail, agent:researcher"
                disabled={p.saving}
                className="h-8 font-mono text-xs"
              />
              <Button size="sm" onClick={p.saveTrusted} disabled={p.saving}>
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Comma-separated exact names. This is an automation allowlist, not
              authentication.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

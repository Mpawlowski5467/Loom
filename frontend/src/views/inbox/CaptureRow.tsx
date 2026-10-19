import { Checkbox } from "@/components/ui/checkbox";
import { formatRelative } from "@/data/formatDate";
import type { Capture } from "@/data/types";
import { plainText } from "@/editor/plainText";
import { cn } from "@/lib/utils";
import { sourceLabel } from "./captureSource";
import { STATUS_CLASS, STATUS_LABEL, type RowStatus } from "./captureStatus";

interface CaptureRowProps {
  capture: Capture;
  status: RowStatus;
  active: boolean;
  checked: boolean;
  checkable: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

/** A capture in the triage list: source, time, status, title, preview. */
export function CaptureRow({
  capture: c,
  status,
  active,
  checked,
  checkable,
  onSelect,
  onToggle,
}: CaptureRowProps) {
  return (
    <li
      className={cn(
        "group flex items-start gap-2 border-b border-border px-3 py-2.5",
        active
          ? "bg-accent shadow-[inset_2px_0_0_var(--brand)]"
          : "hover:bg-accent/50",
      )}
    >
      <Checkbox
        className="mt-1"
        checked={checked}
        disabled={!checkable}
        onCheckedChange={() => onToggle(c.id)}
        aria-label={`Select ${c.title}`}
      />
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(c.id)}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex items-center gap-2 text-[11px]">
          <span className="rounded-sm bg-chip px-1.5 py-0.5 font-medium text-chip-foreground">
            {sourceLabel(c.source)}
          </span>
          <span
            className="font-mono text-muted-foreground"
            title={c.receivedAt}
          >
            {formatRelative(c.receivedAt)}
          </span>
          <span
            className={cn(
              "ml-auto rounded-full border px-2 py-0.5 font-medium",
              STATUS_CLASS[status],
            )}
          >
            {STATUS_LABEL[status]}
          </span>
        </span>
        <span
          data-capture-title=""
          className="truncate text-sm font-medium text-foreground"
        >
          {c.title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {plainText(c.body) || "Empty capture"}
        </span>
      </button>
    </li>
  );
}

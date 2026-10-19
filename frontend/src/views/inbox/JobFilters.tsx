import type { CaptureJobStatus } from "@/api/captures";
import { Button } from "@/components/ui/button";
import { statusLabel } from "./jobLabels";

const select =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface JobFiltersProps {
  segmentLabel: string;
  statuses: readonly CaptureJobStatus[];
  status: "all" | CaptureJobStatus;
  onStatusChange: (status: "all" | CaptureJobStatus) => void;
  sources: readonly string[];
  source: string;
  onSourceChange: (source: string) => void;
  showRetention: boolean;
  retention: string;
  onRetentionChange: (retention: string) => void;
  onPrune: () => void;
}

/** Status and source filters, plus history retention on the History tab. */
export function JobFilters({
  segmentLabel,
  statuses,
  status,
  onStatusChange,
  sources,
  source,
  onSourceChange,
  showRetention,
  retention,
  onRetentionChange,
  onPrune,
}: JobFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 text-xs text-muted-foreground">
      <label className="flex flex-col gap-1">
        <span>Status</span>
        <select
          aria-label="Filter jobs by status"
          value={status}
          onChange={(event) =>
            onStatusChange(event.target.value as "all" | CaptureJobStatus)
          }
          className={select}
        >
          <option value="all">All {segmentLabel.toLowerCase()}</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>Source</span>
        <select
          aria-label="Filter jobs by source"
          value={source}
          onChange={(event) => onSourceChange(event.target.value)}
          className={select}
        >
          <option value="all">All sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      {showRetention && (
        <div className="ml-auto flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span>Retain</span>
            <select
              aria-label="History retention window"
              value={retention}
              onChange={(event) => onRetentionChange(event.target.value)}
              className={select}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">Clear all</option>
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={onPrune}>
            Remove older
          </Button>
        </div>
      )}
    </div>
  );
}

import type { ProcessResult } from "../../lib/api";

export type FilterTab = "all" | "pending" | "processing" | "done" | "manual";

export const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "processing", label: "Processing" },
  { id: "done", label: "Done" },
  { id: "manual", label: "Manual" },
];

export const SOURCE_LABELS: Record<string, string> = {
  manual: "MN",
};

export const POLL_MS = 5_000;

export interface CaptureState {
  status: "pending" | "processing" | "done";
  result?: ProcessResult;
}

/**
 * Shared constants used across multiple components.
 *
 * NODE_COLORS_HEX is the canonical hex map for canvas contexts (Sigma.js)
 * that cannot read CSS variables. DOM components should prefer CSS variables
 * from variables.css (e.g., var(--node-project)) where possible.
 */

/** Hex color map for note types — required by Sigma.js canvas rendering. */
export const NODE_COLORS_HEX: Record<string, string> = {
  project: "#60a5fa",
  topic: "#4ade80",
  person: "#c084fc",
  daily: "#94a3b8",
  capture: "#fbbf24",
  custom: "#2dd4bf",
};

/** CSS variable map for note types — use in DOM contexts. */
export const NODE_COLORS_CSS: Record<string, string> = {
  project: "var(--node-project)",
  topic: "var(--node-topic)",
  person: "var(--node-person)",
  daily: "var(--node-daily)",
  capture: "var(--node-capture)",
  custom: "var(--node-custom)",
};

/** Filter chip labels for graph type filtering. */
export const TYPE_LABELS: { id: string; label: string; color: string }[] = [
  { id: "all", label: "All", color: "" },
  { id: "project", label: "Projects", color: "#60a5fa" },
  { id: "topic", label: "Topics", color: "#4ade80" },
  { id: "person", label: "People", color: "#c084fc" },
  { id: "daily", label: "Daily", color: "#94a3b8" },
  { id: "capture", label: "Captures", color: "#fbbf24" },
];

/** Format an ISO timestamp for display. */
export function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

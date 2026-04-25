/**
 * Shared constants used across multiple components.
 *
 * NODE_COLORS_HEX is the canonical hex map for canvas contexts
 * (react-force-graph-2d node draw callbacks) that cannot read CSS variables.
 * DOM components should prefer CSS variables from variables.css (e.g.,
 * var(--node-project)) where possible.
 */

/** Read the current computed value of a CSS custom property from :root. */
export function getCSSVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) {
    console.warn(`[loom] CSS variable ${name} is not defined in variables.css`);
  }
  return value;
}

/** Build a fresh node-color hex map by reading current CSS variables. */
export function getNodeColorsHex(): Record<string, string> {
  return {
    project: getCSSVar("--node-project") || "#60a5fa",
    topic: getCSSVar("--node-topic") || "#4ade80",
    person: getCSSVar("--node-person") || "#c084fc",
    daily: getCSSVar("--node-daily") || "#94a3b8",
    capture: getCSSVar("--node-capture") || "#fbbf24",
    custom: getCSSVar("--node-custom") || "#2dd4bf",
  };
}

/** Static fallback — used when computed styles aren't available yet. */
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

/** Filter chip labels for graph type filtering. Uses CSS vars so colors follow the theme. */
export const TYPE_LABELS: { id: string; label: string; color: string }[] = [
  { id: "all", label: "All", color: "" },
  { id: "project", label: "Projects", color: "var(--node-project)" },
  { id: "topic", label: "Topics", color: "var(--node-topic)" },
  { id: "person", label: "People", color: "var(--node-person)" },
  { id: "daily", label: "Daily", color: "var(--node-daily)" },
  { id: "capture", label: "Captures", color: "var(--node-capture)" },
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

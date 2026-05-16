import type { ActivityEntry } from "./types";

/**
 * Derive a short initial badge from an agent name, using the minimum-unique
 * prefix among all known agents (1 char if unique, otherwise 2 chars).
 */
export function getInitials(name: string, allNames: string[]): string {
  if (!name) return "?";
  const first = name[0]?.toLowerCase();
  const conflicts = allNames.filter((n) => n[0]?.toLowerCase() === first);
  if (conflicts.length <= 1) return name[0].toUpperCase();
  return name[0].toUpperCase() + (name[1]?.toLowerCase() ?? "");
}

export function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function parseChangelogEntries(agent: string, content: string): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const blocks = content.split(/^## /m).filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timeLine = lines[0]?.trim() || "";
    let action = "";
    let details = "";

    for (const line of lines) {
      if (line.startsWith("- **Action:**")) action = line.replace("- **Action:**", "").trim();
      if (line.startsWith("- **Details:**"))
        details = line.replace("- **Details:**", "").trim();
    }

    if (timeLine && action) {
      entries.push({ time: timeLine, agent, action, details: details || action });
    }
  }

  return entries;
}

/**
 * A capture's `source` as a short badge. MCP and Telegram sources don't exist
 * yet (roadmap items 5 and 7) but get their names when they arrive.
 */
export function sourceLabel(source: string | undefined): string {
  const s = (source ?? "manual").toLowerCase();
  if (s.startsWith("mcp")) return "MCP";
  if (s.includes("telegram")) return "Telegram";
  if (s === "manual:clipper" || s === "bridge:browser") return "Web clip";
  if (s === "manual:pdf") return "PDF";
  if (s.startsWith("manual")) return "Manual";
  if (s === "bridge:email" || s === "bridge:gmail" || s === "bridge:imap")
    return "Email";
  if (s === "bridge:github") return "GitHub";
  if (s.includes("cal")) return "Calendar";
  if (s.startsWith("agent:")) {
    const name = source!.slice("agent:".length);
    return name ? name[0]!.toUpperCase() + name.slice(1) : "Agent";
  }
  return source ?? "Manual";
}

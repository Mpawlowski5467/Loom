/** "agent:spider" / "spider" / "user" → canonical lowercase actor name. */
export function actorName(raw: string): string {
  const name = raw
    .replace(/^agent:/, "")
    .trim()
    .toLowerCase();
  return name === "user" || name === "human" ? "you" : name || "you";
}

/** Display label: "You", "Spider", … */
export function actorLabel(raw: string): string {
  const name = actorName(raw);
  return name === "you" ? "You" : name.charAt(0).toUpperCase() + name.slice(1);
}

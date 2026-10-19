/** Markdown to readable one-line text: wikilinks, emphasis, list marks. */
export function plainText(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

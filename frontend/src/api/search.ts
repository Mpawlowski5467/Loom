import type { Note, NodeType } from "../data/types";

export interface SearchResult {
  note_id: string;
  title: string;
  heading: string;
  snippet: string;
  score: number;
  type: NodeType;
}

function snippetFor(body: string, lowerQuery: string): string {
  const idx = body.toLowerCase().indexOf(lowerQuery);
  if (idx < 0) {
    return body.replace(/\n+/g, " ").slice(0, 110);
  }
  const start = Math.max(0, idx - 24);
  const end = Math.min(body.length, idx + 90);
  let s = body.slice(start, end).replace(/\n+/g, " ");
  if (start > 0) s = "…" + s;
  if (end < body.length) s = s + "…";
  return s;
}

function bestHeading(body: string, lowerQuery: string): string | undefined {
  const headings: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) headings.push(line.slice(3).trim());
  }
  for (const h of headings) {
    if (h.toLowerCase().includes(lowerQuery)) return h;
  }
  return headings[0];
}

export function searchNotes(
  query: string,
  notes: Note[],
  limit = 10,
): SearchResult[] {
  if (!query.trim()) {
    return notes
      .slice()
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, 8)
      .map((n) => ({
        note_id: n.id,
        title: n.title,
        heading: bestHeading(n.body, "") ?? "",
        snippet: snippetFor(n.body, ""),
        score: 0.5 + Math.random() * 0.4,
        type: n.type,
      }));
  }
  const lower = query.toLowerCase();
  const results: SearchResult[] = [];
  for (const n of notes) {
    let score = 0;
    if (n.title.toLowerCase().includes(lower)) score += 0.5;
    if (n.body.toLowerCase().includes(lower)) score += 0.05;
    for (const t of n.tags) {
      if (t.toLowerCase().includes(lower)) score += 0.15;
    }
    for (const line of n.body.split("\n")) {
      if (line.startsWith("## ") && line.toLowerCase().includes(lower)) {
        score += 0.3;
        break;
      }
    }
    if (score > 0) {
      results.push({
        note_id: n.id,
        title: n.title,
        heading: bestHeading(n.body, lower) ?? "",
        snippet: snippetFor(n.body, lower),
        score: Math.min(0.99, score + Math.random() * 0.05),
        type: n.type,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

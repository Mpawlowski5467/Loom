import type { VaultSearchHit } from "@/api/search";
import type { Note } from "@/data/types";
import { queryTerms } from "./match";
import type { PaletteAgent } from "./usePaletteAgents";

export type PaletteChip =
  | "all"
  | "notes"
  | "actions"
  | "agents"
  | `community-${number}`;

export interface NoteItem {
  kind: "note";
  value: string;
  noteId: string;
  title: string;
  snippet: string;
  folder: string;
  slot: number | null;
  note: Note | null;
  hit: VaultSearchHit | null;
}

export type ActionId =
  | "capture"
  | "council"
  | "spider"
  | "new-note"
  | "quick-capture";

export interface ActionItem {
  kind: "action";
  value: string;
  id: ActionId;
  label: string;
  detail: string;
  shortcut?: string;
  /** The note an action works on (Run Spider). */
  target?: Note;
}

export interface AgentItem {
  kind: "agent";
  value: string;
  agent: PaletteAgent;
}

export type PaletteItem = NoteItem | ActionItem | AgentItem;

export interface PaletteGroups {
  notes: NoteItem[];
  actions: ActionItem[];
  agents: AgentItem[];
  /** Superseded notes left out of the results. */
  hiddenSuperseded: number;
}

export interface ItemInputs {
  query: string;
  chip: PaletteChip;
  includeSuperseded: boolean;
  /** Search hits for the query; null while there's no query. */
  hits: VaultSearchHit[] | null;
  notes: readonly Note[];
  noteById: (id: string) => Note | undefined;
  slotOf: ReadonlyMap<string, number | null>;
  contextNote: Note | null;
  agents: readonly PaletteAgent[];
}

const RECENT = 8;

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

function firstParagraph(body: string): string {
  const para = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("---"));
  return plainText(para ?? "").slice(0, 160);
}

function noteItems(i: ItemInputs): { items: NoteItem[]; hidden: number } {
  const visible = (n: Note | undefined) =>
    i.includeSuperseded || n?.status !== "superseded";
  let hidden = 0;
  const items: NoteItem[] = [];
  const add = (id: string, note: Note | null, hit: VaultSearchHit | null) => {
    if (!visible(note ?? undefined)) {
      hidden++;
      return;
    }
    items.push({
      kind: "note",
      value: `note:${id}`,
      noteId: id,
      title: hit?.title ?? note?.title ?? id,
      snippet: hit?.snippet
        ? plainText(hit.snippet)
        : note
          ? firstParagraph(note.body)
          : "",
      folder: note?.folder ?? "",
      slot: i.slotOf.get(id) ?? null,
      note,
      hit,
    });
  };
  if (i.hits)
    for (const hit of i.hits)
      add(hit.noteId, i.noteById(hit.noteId) ?? null, hit);
  else
    i.notes
      .filter((n) => n.status !== "archived")
      .slice()
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, RECENT * 2)
      .forEach((n) => items.length < RECENT && add(n.id, n, null));
  return { items, hidden };
}

function actionItems(i: ItemInputs, notes: NoteItem[]): ActionItem[] {
  const q = i.query.trim();
  const target = i.contextNote ?? (q ? notes[0]?.note : null) ?? null;
  const out: ActionItem[] = q
    ? [
        {
          kind: "action",
          value: "action:capture",
          id: "capture",
          label: `Capture "${q}" to Inbox`,
          detail: "Files the text as a capture for triage.",
          shortcut: "⇧↵",
        },
        {
          kind: "action",
          value: "action:council",
          id: "council",
          label: `Ask Council about "${q}"`,
          detail: "Opens the Council on Board with your question filled in.",
        },
      ]
    : [
        {
          kind: "action",
          value: "action:new-note",
          id: "new-note",
          label: "New note",
          detail: "Create a note in any folder.",
          shortcut: "⌘N",
        },
        {
          kind: "action",
          value: "action:quick-capture",
          id: "quick-capture",
          label: "Capture a thought",
          detail: "Send text or a link to the Inbox.",
          shortcut: "⌘⇧C",
        },
      ];
  if (target)
    out.push({
      kind: "action",
      value: "action:spider",
      id: "spider",
      label: `Run Spider on ${target.title}`,
      detail: "Spider looks for related notes and links the strong matches.",
      target,
    });
  return out;
}

function agentItems(i: ItemInputs): AgentItem[] {
  const terms = queryTerms(i.query);
  return i.agents
    .filter(
      (a) =>
        terms.length === 0 ||
        terms.some((t) => `${a.name} ${a.role}`.toLowerCase().includes(t)),
    )
    .map((agent) => ({ kind: "agent", value: `agent:${agent.id}`, agent }));
}

/** The palette's groups for the current query, chip and options. */
export function buildPaletteGroups(i: ItemInputs): PaletteGroups {
  const { items, hidden } = noteItems(i);
  const community = i.chip.startsWith("community-")
    ? Number(i.chip.slice("community-".length))
    : null;
  const notes =
    community === null ? items : items.filter((n) => n.slot === community);
  const show = (group: "notes" | "actions" | "agents") =>
    i.chip === "all" ||
    i.chip === group ||
    (group === "notes" && community !== null);
  return {
    notes: show("notes") ? notes : [],
    actions: show("actions") ? actionItems(i, items) : [],
    agents: show("agents") ? agentItems(i) : [],
    hiddenSuperseded: hidden,
  };
}

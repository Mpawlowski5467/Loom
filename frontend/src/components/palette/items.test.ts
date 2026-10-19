import { describe, expect, it } from "vitest";
import type { VaultSearchHit } from "@/api/search";
import { supersessionSeed } from "@/data/notesSupersession";
import type { Note } from "@/data/types";
import { buildPaletteGroups, plainText, type ItemInputs } from "./items";
import { localSearch } from "./localSearch";

const [v1, v2, budget] = supersessionSeed as [Note, Note, Note];
const notes = [v1, v2, budget];
const hit = (n: Note): VaultSearchHit => ({
  noteId: n.id,
  title: n.title,
  type: n.type,
  tags: n.tags,
  snippet: "See [[latency-budget|the budget]] and **p95**.",
  heading: "",
  score: 0.02,
  match: null,
});

function inputs(over: Partial<ItemInputs> = {}): ItemInputs {
  return {
    query: "",
    chip: "all",
    includeSuperseded: false,
    hits: null,
    notes,
    noteById: (id) => notes.find((n) => n.id === id),
    slotOf: new Map([
      [v1.id, 0],
      [v2.id, 0],
      [budget.id, null],
    ]),
    contextNote: null,
    agents: [
      {
        id: "spider",
        name: "spider",
        role: "auto-links",
        layer: "loom",
        running: true,
      },
    ],
    ...over,
  };
}

describe("buildPaletteGroups", () => {
  it("shows recent notes, starter actions and every agent without a query", () => {
    const g = buildPaletteGroups(inputs());
    expect(g.notes.map((n) => n.title)).toEqual([
      "Cache plan v2",
      "Latency budget",
    ]);
    expect(g.actions.map((a) => a.id)).toEqual(["new-note", "quick-capture"]);
    expect(g.agents.map((a) => a.agent.id)).toEqual(["spider"]);
  });

  it("hides superseded hits and counts them, unless asked for", () => {
    const hits = [hit(v1), hit(v2)];
    const hidden = buildPaletteGroups(inputs({ query: "cache", hits }));
    expect(hidden.notes.map((n) => n.noteId)).toEqual([v2.id]);
    expect(hidden.hiddenSuperseded).toBe(1);
    expect(hidden.notes[0]!.snippet).toBe("See the budget and p95.");
    const shown = buildPaletteGroups(
      inputs({ query: "cache", hits, includeSuperseded: true }),
    );
    expect(shown.notes).toHaveLength(2);
  });

  it("offers capture, Council and Spider on the top note for a query", () => {
    const g = buildPaletteGroups(inputs({ query: "cache", hits: [hit(v2)] }));
    expect(g.actions.map((a) => a.label)).toEqual([
      'Capture "cache" to Inbox',
      'Ask Council about "cache"',
      "Run Spider on Cache plan v2",
    ]);
    expect(g.agents).toEqual([]);
  });

  it("runs Spider on the open note when there is one", () => {
    const g = buildPaletteGroups(inputs({ contextNote: budget }));
    expect(g.actions.at(-1)).toMatchObject({ id: "spider", target: budget });
  });

  it("narrows to one group or one community", () => {
    const hits = [hit(v2), hit(budget)];
    const agents = buildPaletteGroups(
      inputs({ query: "cache", hits, chip: "agents" }),
    );
    expect([agents.notes.length, agents.actions.length]).toEqual([0, 0]);
    const community = buildPaletteGroups(
      inputs({ query: "cache", hits, chip: "community-0" }),
    );
    expect(community.notes.map((n) => n.noteId)).toEqual([v2.id]);
    expect([community.actions.length, community.agents.length]).toEqual([0, 0]);
  });
});

describe("plainText and localSearch", () => {
  it("flattens markdown to one readable line", () => {
    expect(plainText("## Plan\n- [[a]] then `b`\n- [c](http://x)")).toBe(
      "Plan a then b c",
    );
  });

  it("matches every term against titles and tags, title prefixes first", () => {
    const out = localSearch(notes, "cache plan");
    expect(out.offline).toBe(true);
    expect(out.hits.map((h) => h.title)).toEqual([
      "Cache plan v1",
      "Cache plan v2",
    ]);
    expect(localSearch(notes, "perf").hits.length).toBeGreaterThan(0);
    expect(localSearch(notes, "nothing-like-this").hits).toEqual([]);
  });
});

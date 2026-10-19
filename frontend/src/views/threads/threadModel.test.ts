import { describe, expect, it } from "vitest";
import type { AgentEvent, Capture, Note } from "@/data/types";
import {
  actionsPerDay,
  dailyThreads,
  dayDigest,
  eventDay,
  localDate,
  standupThreads,
  vaultStats,
} from "./threadModel";

const noon = (date: string) => `${date}T12:00:00Z`;

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    type: "topic",
    folder: "topics",
    tags: [],
    body: "",
    links: [],
    history: [],
    created: noon("2026-05-16"),
    modified: noon("2026-05-16"),
    status: "active",
    source: "manual",
    ...patch,
  };
}

function event(id: string, patch: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id,
    ts: noon("2026-05-16"),
    agent: "weaver",
    action: "created",
    target: "",
    chain: "ok",
    sentinel: "ok",
    ...patch,
  };
}

function capture(id: string, patch: Partial<Capture> = {}): Capture {
  return {
    id,
    title: id,
    folder: "captures",
    body: "",
    receivedAt: noon("2026-05-16"),
    status: "pending",
    ...patch,
  };
}

describe("dailyThreads", () => {
  it("lists daily logs newest first with the notes made that day", () => {
    const threads = dailyThreads([
      note("d1", { type: "daily", title: "2026-05-15" }),
      note("d2", {
        type: "daily",
        title: "Saturday",
        created: noon("2026-05-16"),
      }),
      note("a", { created: noon("2026-05-16") }),
      note("b", { created: noon("2026-05-16") }),
      note("gone", { created: noon("2026-05-16"), status: "archived" }),
      note("d3", { type: "daily", title: "2026-05-14", status: "archived" }),
    ]);
    expect(threads.map((t) => [t.id, t.count])).toEqual([
      ["2026-05-16", 2],
      ["2026-05-15", 0],
    ]);
  });
});

describe("standupThreads", () => {
  it("takes Standup captures and filed standup notes, without duplicates", () => {
    const threads = standupThreads(
      [
        note("filed", {
          tags: ["standup"],
          title: "Standup — 2026-05-15",
          created: noon("2026-05-15"),
        }),
        note("same", { tags: ["standup"], title: "Standup — 2026-05-16" }),
        note("daily", { type: "daily", tags: ["standup"] }),
      ],
      [
        capture("c1", {
          source: "agent:standup",
          title: "Standup — 2026-05-16",
        }),
        capture("c2", { source: "agent:standup", status: "done" }),
        capture("c3", { source: "manual" }),
      ],
    );
    expect(threads.map((t) => t.id)).toEqual(["standup-c1", "standup-filed"]);
  });
});

describe("dayDigest", () => {
  const slots = new Map<string, number | null>([
    ["n1", 0],
    ["n2", 2],
  ]);
  const notes = [
    note("n1", { title: "Caching", created: noon("2026-05-16") }),
    note("n2", {
      title: "Webhooks",
      filename: "webhooks.md",
      created: noon("2026-05-15"),
    }),
    note("d", { type: "daily", title: "2026-05-16" }),
  ];

  it("collects new notes, flags and Spider's links for that day", () => {
    const digest = dayDigest(
      "2026-05-16",
      notes,
      [
        capture("c1", { status: "needs_review", title: "Clip" }),
        capture("c2", {
          receivedAt: noon("2026-05-15"),
          status: "needs_review",
        }),
      ],
      [
        event("e1", {
          agent: "sentinel",
          sentinel: "warn",
          action: "validated",
          target: "edit on [[Caching]]",
        }),
        event("e2", {
          agent: "spider",
          action: "linked",
          target: "[[Webhooks]] → [[Caching]]",
        }),
        event("e3", {
          agent: "spider",
          action: "linked",
          ts: noon("2026-05-15"),
        }),
        event("e4", {
          agent: "weaver",
          action: "filed",
          target: "topics/webhooks.md",
        }),
      ],
      slots,
    );
    expect(digest.newNotes.map((r) => [r.text, r.slot])).toEqual([
      ["Caching", 0],
    ]);
    expect(digest.flags).toEqual([
      expect.objectContaining({
        text: "validated edit on Caching",
        meta: "warning",
        slot: 0,
        noteId: "n1",
      }),
      expect.objectContaining({
        text: "Clip",
        meta: "capture to review",
        slot: null,
      }),
    ]);
    expect(digest.links).toEqual([
      expect.objectContaining({
        text: "linked Webhooks → Caching",
        slot: 2,
        noteId: "n2",
      }),
    ]);
  });
});

describe("actionsPerDay", () => {
  it("counts the seven days ending today, oldest first", () => {
    const now = new Date(2026, 4, 16, 15);
    const days = actionsPerDay(
      [
        event("a", { ts: new Date(2026, 4, 16, 9).toISOString() }),
        event("b", { ts: "09:42:14" }),
        event("c", { ts: new Date(2026, 4, 10, 9).toISOString() }),
        event("d", { ts: new Date(2026, 4, 9, 9).toISOString() }),
      ],
      now,
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-05-10", count: 1 });
    expect(days[6]).toEqual({ date: "2026-05-16", count: 2 });
  });

  it("reads time-only stamps as today", () => {
    const now = new Date(2026, 4, 16, 15);
    expect(eventDay("09:42", now)).toBe(localDate(now));
  });
});

describe("vaultStats", () => {
  it("counts live notes, each link once, superseded notes and undos", () => {
    const stats = vaultStats(
      [
        note("a", { links: ["b", "c", "a", "missing"] }),
        note("b", { links: ["a"] }),
        note("c", { status: "superseded" }),
        note("z", { status: "archived", links: ["a"] }),
      ],
      [event("1", { reverted: true }), event("2")],
    );
    expect(stats).toEqual({ notes: 3, links: 2, superseded: 1, undone: 1 });
  });
});

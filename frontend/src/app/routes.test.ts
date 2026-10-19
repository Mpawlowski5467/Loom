import { describe, expect, it } from "vitest";
import type { Note } from "../data/types";
import {
  legacyRedirect,
  noteHref,
  notePathOf,
  parseRoute,
  resolveRouteNote,
  settingsSectionFrom,
} from "./routes";

const note = (id: string, folder: string, filename?: string) =>
  ({ id, folder, filename }) as Note;

describe("parseRoute", () => {
  it("maps each path to its view", () => {
    expect(parseRoute("/graph", "").tab).toBe("graph");
    expect(parseRoute("/board", "").tab).toBe("board");
    expect(parseRoute("/threads/2026-05-14", "")).toMatchObject({
      tab: "threads",
      threadId: "2026-05-14",
    });
    expect(parseRoute("/nowhere", "").tab).toBe("graph");
  });

  it("reads a note path and heading", () => {
    expect(
      parseRoute("/notes/projects/cache%20plan", "?heading=Goals"),
    ).toMatchObject({
      tab: "notes",
      notePath: "projects/cache plan",
      heading: "Goals",
    });
    expect(parseRoute("/notes", "?id=thr_1").noteId).toBe("thr_1");
  });

  it("defaults and canonicalises settings sections", () => {
    expect(parseRoute("/settings", "").settingsSection).toBe("appearance");
    expect(parseRoute("/settings/privacy", "").settingsSection).toBe("privacy");
    expect(settingsSectionFrom("providers")).toBe("models");
    expect(settingsSectionFrom("danger")).toBe("vault");
    expect(settingsSectionFrom("bogus")).toBe("appearance");
  });
});

describe("note paths", () => {
  it("uses the file path under threads/ without .md", () => {
    expect(notePathOf(note("a", "projects", "cache-plan.md"))).toBe(
      "projects/cache-plan",
    );
    expect(noteHref(note("a", "projects", "cache plan.md"), "Goals")).toBe(
      "/notes/projects/cache%20plan?heading=Goals",
    );
    // Seed notes without a filename fall back to their id.
    expect(notePathOf(note("thr_t001", "topics"))).toBe("topics/thr_t001");
  });

  it("resolves a route to a note by path or id", () => {
    const notes = [note("a", "projects", "cache-plan.md"), note("b", "topics")];
    expect(
      resolveRouteNote(parseRoute("/notes/projects/cache-plan", ""), notes),
    ).toBe("a");
    expect(resolveRouteNote(parseRoute("/notes", "?id=b"), notes)).toBe("b");
    expect(
      resolveRouteNote(parseRoute("/notes/projects/gone", ""), notes),
    ).toBeNull();
  });
});

describe("legacyRedirect", () => {
  it("ignores URLs without ?view=", () => {
    expect(legacyRedirect("")).toBeNull();
    expect(legacyRedirect("?demo=1")).toBeNull();
  });

  it("maps old views and keeps unrelated flags", () => {
    expect(legacyRedirect("?view=thread&note=thr_1&heading=Goals")).toBe(
      "/notes?id=thr_1&heading=Goals",
    );
    expect(legacyRedirect("?view=inbox&note=thr_1&demo=1")).toBe(
      "/inbox?demo=1",
    );
    expect(legacyRedirect("?view=settings")).toBe("/settings/appearance");
    expect(legacyRedirect("?view=today")).toBe("/graph");
  });
});

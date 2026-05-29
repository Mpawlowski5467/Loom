import { describe, it, expect } from "vitest";
import { buildFolderTree } from "./treeModel";
import type { Note, NodeType } from "../../../data/types";

function mk(folder: string, title: string, type: NodeType = "custom"): Note {
  return {
    id: `${folder}/${title}`,
    title,
    type,
    folder,
    tags: [],
    body: "",
    links: [],
    history: [],
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    status: "active",
    source: "manual",
  };
}

describe("buildFolderTree", () => {
  it("nests notes by their slash-separated folder path", () => {
    const tree = buildFolderTree(
      [mk("projects/loom-ui", "spec", "project")],
      [],
      "",
    );
    expect(tree).toHaveLength(1);
    const projects = tree[0]!;
    expect(projects.name).toBe("projects");
    expect(projects.path).toBe("projects");
    expect(projects.notes).toHaveLength(0);
    expect(projects.folders).toHaveLength(1);

    const loomUi = projects.folders[0]!;
    expect(loomUi.name).toBe("loom-ui");
    expect(loomUi.path).toBe("projects/loom-ui");
    expect(loomUi.notes.map((n) => n.title)).toEqual(["spec"]);
  });

  it("orders top-level folders by FOLDER_ORDER, then alphabetically", () => {
    const tree = buildFolderTree(
      [
        mk("topics", "t", "topic"),
        mk("daily", "d", "daily"),
        mk("zeta", "z"),
        mk("alpha", "a"),
      ],
      [],
      "",
    );
    // daily (rank 0) and topics (rank 2) lead; unranked custom folders follow
    // alphabetically.
    expect(tree.map((n) => n.name)).toEqual(["daily", "topics", "alpha", "zeta"]);
  });

  it("sorts nested subfolders alphabetically", () => {
    const tree = buildFolderTree(
      [
        mk("projects/zebra", "z", "project"),
        mk("projects/alpha", "a", "project"),
      ],
      [],
      "",
    );
    expect(tree[0]!.folders.map((f) => f.name)).toEqual(["alpha", "zebra"]);
  });

  it("sorts daily notes reverse-chronologically and others alphabetically", () => {
    const daily = buildFolderTree(
      [mk("daily", "2026-05-01", "daily"), mk("daily", "2026-05-29", "daily")],
      [],
      "",
    );
    expect(daily[0]!.notes.map((n) => n.title)).toEqual([
      "2026-05-29",
      "2026-05-01",
    ]);

    const topics = buildFolderTree(
      [mk("topics", "Beta", "topic"), mk("topics", "Alpha", "topic")],
      [],
      "",
    );
    expect(topics[0]!.notes.map((n) => n.title)).toEqual(["Alpha", "Beta"]);
  });

  it("prunes folders with no matching notes when filtering", () => {
    const tree = buildFolderTree(
      [
        mk("projects/loom-ui", "Caching spec", "project"),
        mk("topics", "Embeddings", "topic"),
      ],
      [],
      "cach",
    );
    expect(tree.map((n) => n.name)).toEqual(["projects"]);
    expect(tree[0]!.folders[0]!.notes.map((n) => n.title)).toEqual([
      "Caching spec",
    ]);
  });

  it("materializes empty user-created folders (nested) when not filtering", () => {
    const tree = buildFolderTree([], ["projects/empty"], "");
    expect(tree.map((n) => n.name)).toEqual(["projects"]);
    expect(tree[0]!.folders.map((f) => f.name)).toEqual(["empty"]);
  });

  it("omits empty folders while filtering", () => {
    const tree = buildFolderTree(
      [mk("topics", "Hit", "topic")],
      ["projects/empty"],
      "hit",
    );
    expect(tree.map((n) => n.name)).toEqual(["topics"]);
  });

  it("does not surface root-level notes", () => {
    expect(buildFolderTree([mk("", "Loose")], [], "")).toEqual([]);
  });
});

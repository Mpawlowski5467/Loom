import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../../data/types";
import { FolderSection, TREE_NOTE_PAGE_SIZE } from "./FolderSection";
import type { FolderTreeNode } from "./treeModel";

function note(index: number): Note {
  return {
    id: `thr_${index}`,
    title: `Note ${String(index).padStart(4, "0")}`,
    type: "topic",
    folder: "topics",
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

describe("FolderSection large-vault rendering", () => {
  it("reveals a large folder in bounded pages", async () => {
    const user = userEvent.setup();
    const node: FolderTreeNode = {
      name: "topics",
      path: "topics",
      folders: [],
      notes: Array.from({ length: TREE_NOTE_PAGE_SIZE + 5 }, (_, index) =>
        note(index),
      ),
    };

    render(
      <FolderSection
        node={node}
        depth={0}
        isExpanded={() => true}
        filterActive={false}
        currentNoteId={null}
        linkCount={new Map()}
        interaction={null}
        dropTarget={null}
        dragSource={null}
        onToggle={vi.fn()}
        onOpenNote={vi.fn()}
        onContextMenu={vi.fn()}
        onRenameChange={vi.fn()}
        onRenameSubmit={vi.fn()}
        onRenameCancel={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onFolderDragOver={vi.fn()}
        onFolderDragLeave={vi.fn()}
        onFolderDrop={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("treeitem")).toHaveLength(TREE_NOTE_PAGE_SIZE);
    await user.click(screen.getByRole("button", { name: /Show 5 more notes/ }));
    expect(screen.getAllByRole("treeitem")).toHaveLength(
      TREE_NOTE_PAGE_SIZE + 5,
    );
    expect(
      screen.queryByRole("button", { name: /more notes/ }),
    ).not.toBeInTheDocument();
  });
});

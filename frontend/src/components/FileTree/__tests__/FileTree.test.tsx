import React from "react";
import { render, screen } from "@testing-library/react";
import { FileTree } from "../FileTree";
import type { TreeNode } from "../../../lib/api";
import * as api from "../../../lib/api";

const MOCK_TREE: TreeNode = {
  name: "threads",
  path: "threads",
  is_dir: true,
  note_id: "",
  note_type: "",
  tag_count: 0,
  modified: "",
  children: [
    {
      name: "projects",
      path: "threads/projects",
      is_dir: true,
      note_id: "",
      note_type: "",
      tag_count: 0,
      modified: "",
      children: [
        {
          name: "loom.md",
          path: "threads/projects/loom.md",
          is_dir: false,
          note_id: "thr_loom01",
          note_type: "project",
          tag_count: 2,
          modified: "2026-03-15T10:00:00Z",
          children: [],
        },
      ],
    },
  ],
};

describe("FileTree", () => {
  beforeEach(() => {
    vi.spyOn(api, "fetchTree").mockResolvedValue(MOCK_TREE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing and shows loading then tree", async () => {
    const onSelect = vi.fn();

    render(<FileTree activeFile={null} onFileSelect={onSelect} />);

    // Initially shows loading
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // After fetch resolves, shows vault name and folder
    expect(await screen.findByText("vault")).toBeInTheDocument();
    expect(screen.getByText("projects")).toBeInTheDocument();
    expect(screen.getByText("loom")).toBeInTheDocument();
  });

  it("renders the filter input", async () => {
    render(<FileTree activeFile={null} onFileSelect={vi.fn()} />);

    await screen.findByText("vault");

    expect(screen.getByPlaceholderText("Filter files...")).toBeInTheDocument();
  });

  it("renders the create note button when onCreateNote is provided", async () => {
    const onCreate = vi.fn();

    render(<FileTree activeFile={null} onFileSelect={vi.fn()} onCreateNote={onCreate} />);

    await screen.findByText("vault");

    expect(screen.getByTitle("Create note")).toBeInTheDocument();
  });

  it("shows error state when fetchTree fails", async () => {
    vi.spyOn(api, "fetchTree").mockRejectedValue(new Error("Network error"));

    render(<FileTree activeFile={null} onFileSelect={vi.fn()} />);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });
});

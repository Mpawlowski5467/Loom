import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureReview } from "./CaptureReview";
import { ApiError } from "../../api/client";
import type { Capture } from "../../data/types";

const { findDuplicateCaptures, mergeCaptureReview, getNote } = vi.hoisted(
  () => ({
    findDuplicateCaptures: vi.fn(),
    mergeCaptureReview: vi.fn(),
    getNote: vi.fn(),
  }),
);
vi.mock("../../api/captureReview", () => ({
  findDuplicateCaptures,
  mergeCaptureReview,
}));
vi.mock("../../api/notes", () => ({ getNote }));

const capture: Capture = {
  id: "cap",
  title: "Capture",
  folder: "captures",
  body: "Original capture",
  receivedAt: "2026-01-01",
  status: "pending",
  filePath: "/v/threads/captures/cap.md",
};
beforeEach(() => {
  findDuplicateCaptures.mockReset();
  mergeCaptureReview.mockReset();
  getNote.mockReset();
});

describe("CaptureReview", () => {
  it("loads evidence, builds an editable append, and merges with the loaded version", async () => {
    const user = userEvent.setup();
    const onMerged = vi.fn();
    findDuplicateCaptures.mockResolvedValue([
      {
        note_id: "n1",
        title: "Target",
        score: 0.5,
        rationale: "Shared terms: cache.",
        title_overlap: ["cache"],
        body_overlap: [],
      },
    ]);
    getNote.mockResolvedValue({ body: "Existing", modified: "v1" });
    mergeCaptureReview.mockResolvedValue({ status: "merged" });
    render(
      <CaptureReview
        capture={capture}
        proposedBody="Proposed"
        onMerged={onMerged}
        onSeparate={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Append to Target" }),
    );
    const editor = screen.getByLabelText("Merged note body");
    expect(editor).toHaveValue("Existing\n\nProposed");
    await user.type(editor, " edited");
    await user.click(screen.getByRole("button", { name: "Merge into Target" }));
    await waitFor(() =>
      expect(mergeCaptureReview).toHaveBeenCalledWith(
        expect.objectContaining({
          target_note_id: "n1",
          base_modified: "v1",
          body: "Existing\n\nProposed edited",
        }),
        expect.any(AbortSignal),
      ),
    );
    expect(onMerged).toHaveBeenCalled();
  });

  it("keeps the editor after a stale merge conflict and only updates its base after review", async () => {
    const user = userEvent.setup();
    findDuplicateCaptures.mockResolvedValue([
      {
        note_id: "n1",
        title: "Target",
        score: 0.5,
        rationale: "Shared",
        title_overlap: [],
        body_overlap: [],
      },
    ]);
    getNote.mockResolvedValue({ body: "Existing", modified: "v1" });
    mergeCaptureReview.mockRejectedValue(new ApiError("conflict", 409));
    render(
      <CaptureReview
        capture={capture}
        proposedBody="Proposed"
        onMerged={vi.fn()}
        onSeparate={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Append to Target" }),
    );
    const editor = screen.getByLabelText("Merged note body");
    await user.type(editor, " local");
    await user.click(screen.getByRole("button", { name: "Merge into Target" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /editable merge was kept/,
    );
    expect(editor).toHaveValue("Existing\n\nProposed local");
    getNote.mockResolvedValueOnce({ body: "Remote edit", modified: "v2" });
    await user.click(
      screen.getByRole("button", { name: "Reload target for comparison" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: /Latest target and your edited merge/,
      }),
    ).toBeVisible();
    expect(editor).toHaveValue("Existing\n\nProposed local");
    await user.click(screen.getByRole("button", { name: "Keep edited merge" }));
    mergeCaptureReview.mockRejectedValue(new ApiError("conflict", 409));
    await user.click(screen.getByRole("button", { name: "Merge into Target" }));
    await waitFor(() =>
      expect(mergeCaptureReview).toHaveBeenLastCalledWith(
        expect.objectContaining({
          target_note_id: "n1",
          base_modified: "v2",
          body: "Existing\n\nProposed local",
        }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("blocks target switching until the current target load settles", async () => {
    const user = userEvent.setup();
    let resolveFirst:
      | ((value: { body: string; modified: string }) => void)
      | undefined;
    let resolveSecond:
      | ((value: { body: string; modified: string }) => void)
      | undefined;
    getNote
      .mockImplementationOnce(
        () =>
          new Promise<{ body: string; modified: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ body: string; modified: string }>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    findDuplicateCaptures.mockResolvedValue([
      {
        note_id: "n1",
        title: "First",
        score: 0.5,
        rationale: "Shared",
        title_overlap: [],
        body_overlap: [],
      },
      {
        note_id: "n2",
        title: "Second",
        score: 0.5,
        rationale: "Shared",
        title_overlap: [],
        body_overlap: [],
      },
    ]);
    render(
      <CaptureReview
        capture={capture}
        proposedBody="Proposed"
        onMerged={vi.fn()}
        onSeparate={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Append to First" }),
    );
    expect(
      screen.getAllByRole("button", { name: "Loading target…" })[1],
    ).toBeDisabled();
    resolveFirst?.({ body: "First body", modified: "v1" });
    await screen.findByRole("button", { name: "Merge into First" });
    await user.click(screen.getByRole("button", { name: "Append to Second" }));
    resolveSecond?.({ body: "Second body", modified: "v2" });
    expect(
      await screen.findByRole("button", { name: "Merge into Second" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Merged note body")).toHaveValue(
      "Second body\n\nProposed",
    );
  });
});

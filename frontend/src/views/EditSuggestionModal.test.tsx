import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditSuggestionModal } from "./EditSuggestionModal";
import type { Capture } from "../data/types";

vi.mock("../api/captures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/captures")>();
  return {
    ...actual,
    previewCapture: vi.fn(),
    commitCapture: vi.fn(),
  };
});

function mkCapture(over: Partial<Capture> = {}): Capture {
  return {
    id: "cap_1",
    title: "Raw idea",
    folder: "captures",
    body: "Some captured text.",
    receivedAt: "2026-06-01T10:00:00Z",
    status: "pending",
    ...over,
  };
}

function renderModal() {
  const onClose = vi.fn();
  const onAccepted = vi.fn();
  render(
    <EditSuggestionModal
      capture={mkCapture()}
      onClose={onClose}
      onAccepted={onAccepted}
    />,
  );
  return { onClose, onAccepted };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditSuggestionModal discard guard", () => {
  it("closes immediately on Cancel when there are no edits", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    // No confirm dialog when nothing was changed.
    expect(
      screen.queryByText("Discard your changes to this suggestion?"),
    ).not.toBeInTheDocument();
  });

  it("routes a dirty Cancel through the accessible ConfirmModal", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    // Make an edit so the dirty guard engages.
    const titleInput = screen.getByDisplayValue("Raw idea");
    await user.type(titleInput, " edited");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // The discard confirmation appears as a dialog, not a window.confirm.
    expect(
      screen.getByRole("heading", {
        name: "Discard your changes to this suggestion?",
      }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Confirming the discard closes the editor.
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor open when the discard is cancelled", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    const titleInput = screen.getByDisplayValue("Raw idea");
    await user.type(titleInput, "x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // The discard dialog's own Cancel dismisses just the confirm.
    const cancels = screen.getAllByRole("button", { name: "Cancel" });
    await user.click(cancels[cancels.length - 1]);

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Discard your changes to this suggestion?"),
    ).not.toBeInTheDocument();
    // The edit form is still mounted.
    expect(screen.getByText("Edit suggestion")).toBeInTheDocument();
  });
});

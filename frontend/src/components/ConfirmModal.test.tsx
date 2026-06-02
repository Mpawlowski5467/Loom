/*
Frontend testing conventions: render, interact, assert visible output;
prefer getByRole. Mock async callbacks with vi.fn().
*/
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ConfirmModal } from "./ConfirmModal";

function setup(over: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmModal
      title="Archive this note?"
      body="It moves to the archive."
      confirmLabel="Archive"
      onConfirm={onConfirm}
      onClose={onClose}
      {...over}
    />,
  );
  return { onConfirm, onClose };
}

describe("ConfirmModal", () => {
  it("renders an accessible dialog with the title and body", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "confirm-modal-title");
    expect(screen.getByText("Archive this note?")).toBeInTheDocument();
    expect(screen.getByText("It moves to the archive.")).toBeInTheDocument();
  });

  it("calls onConfirm then onClose when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms on Enter and cancels on Escape", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = setup();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    // A fresh modal for the Escape path.
    onConfirm.mockClear();
    onClose.mockClear();
    const second = setup();
    await user.keyboard("{Escape}");
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.onConfirm).not.toHaveBeenCalled();
  });

  it("closes without confirming when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the error when onConfirm throws", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();
    render(
      <ConfirmModal
        title="Archive?"
        body="b"
        confirmLabel="Archive"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive" }));

    await screen.findByText("boom");
    expect(onClose).not.toHaveBeenCalled();
    // The button offers a retry after a failure.
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

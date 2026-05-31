import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TypedConfirmModal } from "./TypedConfirmModal";

function setup(overrides: { onConfirm?: () => Promise<void> | void } = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <TypedConfirmModal
      phrase="DELETE main"
      body="This erases the vault."
      destructiveLabel="Permanently delete"
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose };
}

describe("TypedConfirmModal", () => {
  it("keeps the confirm button disabled until the phrase matches exactly", async () => {
    const user = userEvent.setup();
    setup();
    const confirm = screen.getByRole("button", { name: "Permanently delete" });
    expect(confirm).toBeDisabled();

    const input = screen.getByRole("textbox");
    await user.type(input, "DELETE mai"); // close but not exact
    expect(confirm).toBeDisabled();

    await user.type(input, "n"); // now "DELETE main"
    expect(confirm).toBeEnabled();
  });

  it("calls onConfirm then onClose on a successful confirm", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = setup();
    await user.type(screen.getByRole("textbox"), "DELETE main");
    await user.click(screen.getByRole("button", { name: "Permanently delete" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("confirms on Enter when the phrase matches", async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();
    await user.type(screen.getByRole("textbox"), "DELETE main{Enter}");
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });

  it("keeps the modal open and shows the error when onConfirm throws", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error("server said no"));
    const { onClose } = setup({ onConfirm });
    await user.type(screen.getByRole("textbox"), "DELETE main");
    await user.click(screen.getByRole("button", { name: "Permanently delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("server said no");
    expect(onClose).not.toHaveBeenCalled();
    // The button relabels to Retry and the typed phrase is preserved.
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.getByRole("textbox")).toHaveValue("DELETE main");
  });

  it("closes on Cancel without confirming", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.type(screen.getByRole("textbox"), "{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

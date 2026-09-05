import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { QuickCapture } from "./QuickCapture";

const { createCapture } = vi.hoisted(() => ({ createCapture: vi.fn() }));
vi.mock("../api/captures", () => ({ createCapture }));

function renderCapture(onClose = vi.fn()) {
  const pushToast = vi.fn();
  const setTab = vi.fn();
  const rendered = render(
    <AppCtx.Provider
      value={{ pushToast, setTab } as unknown as AppContextValue}
    >
      <QuickCapture onClose={onClose} />
    </AppCtx.Provider>,
  );
  return { pushToast, setTab, onClose, ...rendered };
}

beforeEach(() => {
  createCapture.mockReset();
  localStorage.clear();
});

describe("QuickCapture", () => {
  it("sends a URL through unified capture ingress and opens the Inbox", async () => {
    const user = userEvent.setup();
    createCapture.mockResolvedValue({ deduplicated: false });
    const spies = renderCapture();
    await user.type(
      screen.getByLabelText("Capture content"),
      "https://example.com/article",
    );
    await user.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() =>
      expect(createCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "example.com",
          source: "manual:quick-capture",
          provenance: { url: "https://example.com/article" },
        }),
        expect.any(AbortSignal),
      ),
    );
    expect(spies.setTab).toHaveBeenCalledWith("inbox");
    expect(spies.onClose).toHaveBeenCalled();
  });

  it("persists a draft across close and retry uses its stable id", async () => {
    const user = userEvent.setup();
    createCapture
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ deduplicated: true });
    const first = renderCapture();
    await user.type(screen.getByLabelText("Capture content"), "retry thought");
    await user.click(screen.getByRole("button", { name: "Capture" }));
    await screen.findByText("offline");
    const firstId = createCapture.mock.calls[0][0].external_id;
    first.unmount();
    renderCapture();
    expect(screen.getByLabelText("Capture content")).toHaveValue(
      "retry thought",
    );
    await user.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(createCapture).toHaveBeenCalledTimes(2));
    expect(createCapture.mock.calls[1][0].external_id).toBe(firstId);
  });
});

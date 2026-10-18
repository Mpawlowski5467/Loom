import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PolicySection } from "./PolicySection";

const { getPolicy, savePolicy } = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  savePolicy: vi.fn(),
}));
vi.mock("../../api/policy", () => ({ getPolicy, savePolicy }));
const policy = {
  paused: false,
  per_source_daily_capture_limit: 0,
  daily_token_limit: 0,
  excluded_cloud_folders: [],
  excluded_cloud_tags: [],
  retain_raw_traces: false,
  provider_prices_per_1k: {},
};

describe("PolicySection", () => {
  it("disables save after load failure", async () => {
    getPolicy.mockRejectedValueOnce(new Error("offline"));
    render(<PolicySection />);
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save policy/i })).toBeDisabled();
  });
  it("parses comma inputs and saves policy", async () => {
    getPolicy.mockResolvedValueOnce({
      policy,
      usage: {
        day: "x",
        total_tokens: 0,
        tokens_by_provider: {},
        captures_by_source: {},
      },
    });
    savePolicy.mockResolvedValueOnce({
      policy,
      usage: {
        day: "x",
        total_tokens: 0,
        tokens_by_provider: {},
        captures_by_source: {},
      },
    });
    const user = userEvent.setup();
    render(<PolicySection />);
    await screen.findByRole("button", { name: /save policy/i });
    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0], "private, legal");
    await user.click(screen.getByRole("button", { name: /save policy/i }));
    await waitFor(() =>
      expect(savePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          excluded_cloud_folders: ["private", "legal"],
        }),
      ),
    );
  });
});

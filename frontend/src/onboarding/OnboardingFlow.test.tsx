import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vaultExists } from "../api/vault";
import { OnboardingFlow } from "./OnboardingFlow";

const { completeOnboardingMock } = vi.hoisted(() => ({
  completeOnboardingMock: vi.fn(),
}));

vi.mock("../context/app-ctx", () => ({
  useApp: () => ({
    theme: "paper",
    completeOnboarding: completeOnboardingMock,
  }),
}));

vi.mock("../api/vault", () => ({
  vaultExists: vi.fn(),
}));

const vaultExistsMock = vi.mocked(vaultExists);

describe("OnboardingFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vaultExistsMock.mockResolvedValue({
      name: "default",
      exists: false,
      scaffolded: false,
    });
    completeOnboardingMock.mockResolvedValue(undefined);
    // "Skip for now" now asks for confirmation before leaving providers unset.
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders Welcome first", () => {
    render(<OnboardingFlow />);

    expect(
      screen.getByRole("heading", { name: "Welcome to Loom" }),
    ).toBeInTheDocument();
  });

  it("forward arrows step through and Back returns", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow />);

    await user.click(screen.getByRole("button", { name: "Begin →" }));
    expect(
      screen.getByRole("heading", { name: "Pick a vault" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next →" }));
    expect(
      screen.getByRole("heading", { name: "Pick a look" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(
      screen.getByRole("heading", { name: "Pick a vault" }),
    ).toBeInTheDocument();
  });

  it("submit calls completeOnboarding with the right payload", async () => {
    const user = userEvent.setup();
    render(<OnboardingFlow />);

    await user.click(screen.getByRole("button", { name: "Begin →" }));
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() =>
      expect(completeOnboardingMock).toHaveBeenCalledWith({
        theme: "paper",
        vault_name: "default",
        overwrite_existing_vault: false,
        providers: [],
        chat_provider: null,
        embed_provider: null,
        steps_done: ["welcome", "vault", "theme", "provider"],
      }),
    );
  });
});

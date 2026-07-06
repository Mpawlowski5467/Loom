import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddAgentModal } from "./AddAgentModal";
import { PROMPT_TEMPLATES } from "./promptTemplates";
import type { AgentRegistryRecord } from "../../api/agentsRegistry";

const { createCustomAgent, updateCustomAgent } = vi.hoisted(() => ({
  createCustomAgent: vi.fn(),
  updateCustomAgent: vi.fn(),
}));

vi.mock("../../api/agentsRegistry", () => ({
  createCustomAgent,
  updateCustomAgent,
}));

const EXISTING: AgentRegistryRecord = {
  id: "my-agent",
  name: "My Agent",
  layer: "shuttle",
  role: "Finds things",
  icon: "⚡",
  system_prompt: "You are My Agent.",
  system: false,
  provider: "anthropic",
  chat_model: "claude-3-5-haiku-latest",
};

function renderModal(existing?: AgentRegistryRecord) {
  const onClose = vi.fn();
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(
    <AddAgentModal existing={existing} onClose={onClose} onSaved={onSaved} />,
  );
  return { onClose, onSaved };
}

beforeEach(() => {
  createCustomAgent.mockReset().mockResolvedValue(EXISTING);
  updateCustomAgent.mockReset().mockResolvedValue(EXISTING);
});

describe("AddAgentModal create flow", () => {
  it("creates an agent with a template prompt, picked icon, and model override", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await user.type(screen.getByLabelText("Name"), "Scout");
    await user.type(screen.getByLabelText(/Role/), "finds things");

    // Template chip inserts a starter prompt into the empty textarea.
    await user.click(screen.getByRole("button", { name: "Summarizer" }));
    const summarizer = PROMPT_TEMPLATES.find((t) => t.name === "Summarizer")!;
    expect(screen.getByLabelText("Instructions")).toHaveValue(summarizer.prompt);
    expect(screen.getByText(`${summarizer.prompt.length} chars`)).toBeInTheDocument();

    // Icon picker: pick a suggested glyph.
    const glyph = screen.getByRole("button", { name: "Icon ⚡" });
    await user.click(glyph);
    expect(glyph).toHaveAttribute("aria-pressed", "true");

    // Model override: open the collapsed row, choose a provider + model.
    await user.click(screen.getByRole("button", { name: /Model/ }));
    await user.selectOptions(screen.getByLabelText("Provider"), "openai");
    await user.click(screen.getByPlaceholderText("model name"));
    await user.click(screen.getByRole("button", { name: "gpt-4o-mini" }));

    await user.click(screen.getByRole("button", { name: "Add agent" }));

    await waitFor(() =>
      expect(createCustomAgent).toHaveBeenCalledWith({
        name: "Scout",
        role: "finds things",
        icon: "⚡",
        system_prompt: summarizer.prompt,
        provider: "openai",
        chat_model: "gpt-4o-mini",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("asks before overwriting non-empty instructions with a template", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText("Instructions"), "hand-written");
    await user.click(screen.getByRole("button", { name: "Critic" }));

    // Nothing replaced yet — an inline confirm appears.
    expect(screen.getByLabelText("Instructions")).toHaveValue("hand-written");
    expect(screen.getByText(/Replace the current instructions/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace" }));
    const critic = PROMPT_TEMPLATES.find((t) => t.name === "Critic")!;
    expect(screen.getByLabelText("Instructions")).toHaveValue(critic.prompt);
  });

  it("keeps the user's instructions when the overwrite is declined", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText("Instructions"), "hand-written");
    await user.click(screen.getByRole("button", { name: "Critic" }));
    await user.click(screen.getByRole("button", { name: "Keep mine" }));

    expect(screen.getByLabelText("Instructions")).toHaveValue("hand-written");
    expect(
      screen.queryByText(/Replace the current instructions/),
    ).not.toBeInTheDocument();
  });

  it("gates submission on a non-empty name", async () => {
    const user = userEvent.setup();
    renderModal();

    const submitBtn = screen.getByRole("button", { name: "Add agent" });
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), "  ");
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), "Scout");
    expect(submitBtn).toBeEnabled();
    expect(createCustomAgent).not.toHaveBeenCalled();
  });
});

describe("AddAgentModal edit flow", () => {
  it("prefills every field from the existing record and PATCHes on save", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderModal(EXISTING);

    expect(screen.getByLabelText("Name")).toHaveValue("My Agent");
    expect(screen.getByLabelText(/Role/)).toHaveValue("Finds things");
    expect(screen.getByLabelText("Custom icon")).toHaveValue("⚡");
    expect(screen.getByLabelText("Instructions")).toHaveValue("You are My Agent.");
    // A saved override renders the Model row already expanded and prefilled.
    expect(screen.getByLabelText("Provider")).toHaveValue("anthropic");
    expect(screen.getByPlaceholderText("model name")).toHaveValue(
      "claude-3-5-haiku-latest",
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateCustomAgent).toHaveBeenCalledWith("my-agent", {
        name: "My Agent",
        role: "Finds things",
        icon: "⚡",
        system_prompt: "You are My Agent.",
        provider: "anthropic",
        chat_model: "claude-3-5-haiku-latest",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("clears the model when the provider changes", async () => {
    const user = userEvent.setup();
    renderModal(EXISTING);

    await user.selectOptions(screen.getByLabelText("Provider"), "openai");
    expect(screen.getByPlaceholderText("model name")).toHaveValue("");
  });

  it("shows a server error inline and stays open", async () => {
    updateCustomAgent.mockRejectedValue(new Error("Name must contain letters"));
    const user = userEvent.setup();
    const { onSaved } = renderModal(EXISTING);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Name must contain letters"),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentModels, putAgentModels } from "../../api/agentModels";
import { listModels } from "../../api/providers";
import type { AgentModelsResponse } from "../../api/types";
import { AgentModelsCard } from "./AgentModelsCard";

vi.mock("../../api/agentModels", () => ({
  getAgentModels: vi.fn(),
  putAgentModels: vi.fn(),
}));
vi.mock("../../api/providers", () => ({
  listModels: vi.fn(),
}));

const mockedGet = vi.mocked(getAgentModels);
const mockedPut = vi.mocked(putAgentModels);
const mockedModels = vi.mocked(listModels);

function mkResponse(
  overrides: Partial<AgentModelsResponse> = {},
): AgentModelsResponse {
  return {
    agents: [
      {
        id: "weaver",
        name: "Weaver",
        icon: "🕸",
        layer: "loom",
        system: true,
        provider: "ollama",
        chat_model: "llama3.1:8b",
      },
      {
        id: "scout",
        name: "Scout",
        icon: "🔭",
        layer: "shuttle",
        system: false,
        provider: "",
        chat_model: "",
      },
    ],
    default_provider: "openai",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedModels.mockResolvedValue({
    chat: [{ id: "live-model:7b", name: "live-model:7b", type: "chat" }],
    embed: [],
  });
});

describe("AgentModelsCard", () => {
  it("hydrates a row per agent with its override values", async () => {
    mockedGet.mockResolvedValue(mkResponse());
    render(<AgentModelsCard />);

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);

    const weaver = rows[0]!;
    expect(within(weaver).getByText("Weaver")).toBeInTheDocument();
    expect(within(weaver).getByRole("combobox")).toHaveValue("ollama");
    expect(
      within(weaver).getByPlaceholderText("model name"),
    ).toHaveValue("llama3.1:8b");

    // Overridden providers get a live model listing on hydrate.
    expect(mockedModels).toHaveBeenCalledWith("ollama");
    // The empty row's model picker stays disabled until a provider is picked.
    const scout = rows[1]!;
    expect(within(scout).getByRole("combobox")).toHaveValue("");
    expect(
      within(scout).getByPlaceholderText("Unavailable"),
    ).toBeDisabled();
  });

  it("merges live and static models into the combobox options", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(mkResponse());
    render(<AgentModelsCard />);

    const rows = await screen.findAllByRole("listitem");
    // Clear the current value so the full (unfiltered) option list shows.
    await user.clear(within(rows[0]!).getByPlaceholderText("model name"));
    await user.click(within(rows[0]!).getByPlaceholderText("model name"));

    // Live Ollama tag plus the static catalog suggestion, deduplicated.
    expect(
      within(rows[0]!).getByRole("button", { name: "live-model:7b" }),
    ).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole("button", { name: "llama3" }),
    ).toBeInTheDocument();
  });

  it("enables the model picker and fetches models once a provider is picked", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(mkResponse());
    render(<AgentModelsCard />);

    const rows = await screen.findAllByRole("listitem");
    const scout = rows[1]!;
    await user.selectOptions(within(scout).getByRole("combobox"), "openai");

    expect(mockedModels).toHaveBeenCalledWith("openai");
    expect(
      within(scout).getByPlaceholderText("model name"),
    ).toBeEnabled();
  });

  it("keeps Save disabled until a row changes", async () => {
    mockedGet.mockResolvedValue(mkResponse());
    render(<AgentModelsCard />);

    await screen.findAllByRole("listitem");
    expect(
      screen.getByRole("button", { name: /save agent models/i }),
    ).toBeDisabled();
  });

  it("saves the full override map, omitting empty rows", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(mkResponse());
    mockedPut.mockResolvedValue(mkResponse());
    render(<AgentModelsCard />);

    const rows = await screen.findAllByRole("listitem");
    const weaverModel = within(rows[0]!).getByPlaceholderText("model name");
    await user.clear(weaverModel);
    await user.type(weaverModel, "qwen2.5:7b");
    await user.click(
      screen.getByRole("button", { name: /save agent models/i }),
    );

    // Scout's row is untouched (empty) and must be omitted from the payload.
    expect(mockedPut).toHaveBeenCalledWith({
      weaver: { provider: "ollama", chat_model: "qwen2.5:7b" },
    });
    expect(
      await screen.findByText(/saved\. agents rebound immediately\./i),
    ).toBeInTheDocument();
    // Save is disabled again once the response re-hydrates the rows.
    expect(
      screen.getByRole("button", { name: /save agent models/i }),
    ).toBeDisabled();
  });

  it("surfaces a save failure and stays dirty", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(mkResponse());
    mockedPut.mockRejectedValue(new Error("Unknown provider 'x'"));
    render(<AgentModelsCard />);

    const rows = await screen.findAllByRole("listitem");
    const weaverModel = within(rows[0]!).getByPlaceholderText("model name");
    await user.type(weaverModel, "x");
    await user.click(
      screen.getByRole("button", { name: /save agent models/i }),
    );

    expect(
      await screen.findByText("Unknown provider 'x'"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save agent models/i }),
    ).toBeEnabled();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { ProvidersSection } from "./ProvidersSection";
import type { SettingsProvider } from "../../api/settings";

const { getSettingsProviders, saveSettingsProviders, patchConfig, testProvider } =
  vi.hoisted(() => ({
    getSettingsProviders: vi.fn(),
    saveSettingsProviders: vi.fn(),
    patchConfig: vi.fn(),
    testProvider: vi.fn(),
  }));

vi.mock("../../api/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/settings")>();
  return { ...actual, getSettingsProviders, saveSettingsProviders };
});
vi.mock("../../api/config", () => ({ patchConfig }));
vi.mock("../../api/providers", () => ({ testProvider }));

function mkSettingsProvider(
  overrides: Partial<SettingsProvider> = {},
): SettingsProvider {
  return {
    name: "openai",
    type: "cloud",
    api_key: "",
    api_key_set: true,
    host: "",
    base_url: "",
    chat_model: "gpt-4o-mini",
    embed_model: "text-embedding-3-small",
    is_default_chat: true,
    is_default_embed: true,
    ...overrides,
  };
}

function renderSection(
  providers: SettingsProvider[],
  ctx: Partial<AppContextValue> = {},
) {
  const refreshConfig = vi.fn().mockResolvedValue(undefined);
  const pushToast = vi.fn();
  const value = {
    config: { default_provider: "openai" },
    refreshConfig,
    pushToast,
    ...ctx,
  } as unknown as AppContextValue;

  getSettingsProviders.mockResolvedValue({
    providers,
    active_vault: "main",
  });

  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <ProvidersSection />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { refreshConfig, pushToast };
}

beforeEach(() => {
  getSettingsProviders.mockReset();
  saveSettingsProviders.mockReset();
  patchConfig.mockReset();
  testProvider.mockReset();
  patchConfig.mockResolvedValue({});
  saveSettingsProviders.mockResolvedValue({
    saved: 1,
    default_chat_provider: "openai",
    default_embed_provider: "openai",
  });
});

describe("ProvidersSection — hydration", () => {
  it("hydrates the default-provider radio from the saved config", async () => {
    renderSection([mkSettingsProvider()]);
    const radio = await screen.findByRole("radio", { name: "OpenAI" });
    expect(radio).toBeChecked();
  });

  it("warns when no configured provider supports embeddings", async () => {
    // Anthropic is chat-only → no embed provider configured.
    renderSection([
      mkSettingsProvider({ name: "anthropic", embed_model: "" }),
    ]);
    expect(
      await screen.findByText(/No embedding provider/),
    ).toBeInTheDocument();
  });

  it("always shows the plaintext-key storage note", async () => {
    renderSection([mkSettingsProvider()]);
    expect(
      await screen.findByText(/Keys are stored unencrypted/),
    ).toBeInTheDocument();
  });

  it("does not warn when an embed-capable provider is configured", async () => {
    renderSection([mkSettingsProvider({ name: "openai" })]);
    await screen.findByRole("radio", { name: "OpenAI" });
    expect(screen.queryByText(/No embedding provider/)).not.toBeInTheDocument();
  });
});

describe("ProvidersSection — saving", () => {
  it("saves configured providers and patches the default", async () => {
    const user = userEvent.setup();
    const { refreshConfig } = renderSection([mkSettingsProvider()]);
    await screen.findByRole("radio", { name: "OpenAI" });

    await user.click(screen.getByRole("button", { name: /Save providers/ }));

    await waitFor(() => expect(saveSettingsProviders).toHaveBeenCalled());
    const payload = saveSettingsProviders.mock.calls[0]![0];
    expect(payload[0]).toMatchObject({ name: "openai", is_default: true });
    expect(patchConfig).toHaveBeenCalledWith({ default_provider: "openai" });
    expect(refreshConfig).toHaveBeenCalled();
    expect(await screen.findByText("Provider settings saved.")).toBeInTheDocument();
  });

  it("blocks saving a cloud provider with no key (typed or stored)", async () => {
    const user = userEvent.setup();
    // api_key_set false + no typed key → must be blocked.
    renderSection([mkSettingsProvider({ api_key_set: false })]);
    await screen.findByRole("radio", { name: "OpenAI" });

    await user.click(screen.getByRole("button", { name: /Save providers/ }));

    expect(
      await screen.findByText(/Add an API key before saving: OpenAI/),
    ).toBeInTheDocument();
    expect(saveSettingsProviders).not.toHaveBeenCalled();
  });

  it("allows saving when a stored key already exists", async () => {
    const user = userEvent.setup();
    renderSection([mkSettingsProvider({ api_key_set: true })]);
    await screen.findByRole("radio", { name: "OpenAI" });
    await user.click(screen.getByRole("button", { name: /Save providers/ }));
    await waitFor(() => expect(saveSettingsProviders).toHaveBeenCalled());
  });

  it("surfaces a save failure message", async () => {
    const user = userEvent.setup();
    saveSettingsProviders.mockRejectedValue(new Error("disk error"));
    renderSection([mkSettingsProvider()]);
    await screen.findByRole("radio", { name: "OpenAI" });
    await user.click(screen.getByRole("button", { name: /Save providers/ }));
    expect(await screen.findByText("disk error")).toBeInTheDocument();
  });
});

describe("ProvidersSection — default provider", () => {
  it("patches and refreshes config when a different default is chosen", async () => {
    const user = userEvent.setup();
    const { refreshConfig } = renderSection([
      mkSettingsProvider({ name: "openai" }),
      mkSettingsProvider({ name: "ollama", embed_model: "nomic-embed-text" }),
    ]);
    await screen.findByRole("radio", { name: "OpenAI" });

    await user.click(screen.getByRole("radio", { name: "Ollama" }));

    await waitFor(() =>
      expect(patchConfig).toHaveBeenCalledWith({ default_provider: "ollama" }),
    );
    expect(refreshConfig).toHaveBeenCalled();
  });

  it("toasts when persisting the default provider fails", async () => {
    const user = userEvent.setup();
    patchConfig.mockRejectedValue(new Error("nope"));
    const { pushToast } = renderSection([
      mkSettingsProvider({ name: "openai" }),
      mkSettingsProvider({ name: "ollama", embed_model: "nomic-embed-text" }),
    ]);
    await screen.findByRole("radio", { name: "OpenAI" });
    await user.click(screen.getByRole("radio", { name: "Ollama" }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ body: "nope" }),
      ),
    );
  });
});

describe("ProvidersSection — test connection", () => {
  it("shows a successful test result", async () => {
    const user = userEvent.setup();
    testProvider.mockResolvedValue({ ok: true, latency_ms: 42, error: null });
    renderSection([mkSettingsProvider()]);
    await screen.findByRole("radio", { name: "OpenAI" });

    // OpenAI accordion is open by default; click its Test button.
    await user.click(screen.getByRole("button", { name: /Test/ }));
    expect(await screen.findByText(/OK — 42ms/)).toBeInTheDocument();
  });

  it("surfaces a thrown test error as a failed result (regression for the silent-spinner fix)", async () => {
    const user = userEvent.setup();
    testProvider.mockRejectedValue(new Error("connection refused"));
    renderSection([mkSettingsProvider()]);
    await screen.findByRole("radio", { name: "OpenAI" });

    await user.click(screen.getByRole("button", { name: /Test/ }));
    expect(
      await screen.findByText(/Failed — connection refused/),
    ).toBeInTheDocument();
  });
});

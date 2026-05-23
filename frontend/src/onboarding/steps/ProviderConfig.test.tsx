import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testProvider } from "../../api/providers";
import { ProviderConfig } from "./ProviderConfig";

vi.mock("../../api/providers", () => ({
  testProvider: vi.fn(),
}));

const testProviderMock = vi.mocked(testProvider);

function renderProviderConfig(
  props: Partial<Parameters<typeof ProviderConfig>[0]> = {},
) {
  const baseProps: Parameters<typeof ProviderConfig>[0] = {
    providers: [],
    chatProvider: null,
    embedProvider: null,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onBack: vi.fn(),
    submitting: false,
    submitError: null,
  };
  return {
    props: { ...baseProps, ...props },
    ...render(<ProviderConfig {...baseProps} {...props} />),
  };
}

describe("ProviderConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testProviderMock.mockResolvedValue({
      ok: true,
      latency_ms: 12,
      error: null,
    });
  });

  it("renders all provider options", () => {
    renderProviderConfig();

    expect(
      screen.getByRole("button", { name: /OpenAI/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Anthropic/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /xAI/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /OpenRouter/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ollama/ })).toBeInTheDocument();
  });

  it("picking a provider adds it with defaults", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderProviderConfig({ onChange });

    await user.click(screen.getByRole("button", { name: /OpenAI/ }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.arrayContaining([
          expect.objectContaining({
            name: "openai",
            chat_model: "gpt-4o-mini",
            embed_model: "text-embedding-3-small",
          }),
        ]),
        chatProvider: "openai",
        embedProvider: "openai",
      }),
    );
  });

  it("test button calls testProvider with the right args", async () => {
    const user = userEvent.setup();
    renderProviderConfig({
      providers: [
        {
          name: "openai",
          api_key: "sk-test",
          chat_model: "gpt-4o-mini",
          embed_model: "text-embedding-3-small",
          host: "",
        },
      ],
      chatProvider: "openai",
      embedProvider: "openai",
    });

    await user.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(testProviderMock).toHaveBeenCalledWith("openai", {
        api_key: "sk-test",
        host: "",
      }),
    );
    expect(screen.getByText("OK — 12ms")).toBeInTheDocument();
  });

  it("skip button clears providers and submits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    renderProviderConfig({ onChange, onSubmit });

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(onChange).toHaveBeenCalledWith({
      providers: [],
      chatProvider: null,
      embedProvider: null,
    });
    expect(onSubmit).toHaveBeenCalled();
  });
});

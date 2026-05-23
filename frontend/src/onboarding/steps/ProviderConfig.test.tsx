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
    provider: null,
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

    expect(screen.getByRole("radio", { name: /OpenAI/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Anthropic/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /xAI/ })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /OpenRouter/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Ollama/ })).toBeInTheDocument();
  });

  it("picking a provider populates defaults", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderProviderConfig({ onChange });

    await user.click(screen.getByRole("radio", { name: /OpenAI/ }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "openai",
        chat_model: "gpt-4o-mini",
        embed_model: "text-embedding-3-small",
      }),
    );
  });

  it("test button calls testProvider with the right args", async () => {
    const user = userEvent.setup();
    renderProviderConfig({
      provider: {
        name: "openai",
        api_key: "sk-test",
        chat_model: "gpt-4o-mini",
        embed_model: "text-embedding-3-small",
        host: "",
      },
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

  it("skip button clears provider and submits", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    renderProviderConfig({ onChange, onSubmit });

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onSubmit).toHaveBeenCalled();
  });
});

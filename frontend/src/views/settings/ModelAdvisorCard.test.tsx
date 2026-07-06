import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRecommendations, runBenchmark } from "../../api/hardware";
import type {
  BenchmarkResponse,
  HardwareProfile,
  ModelRecommendation,
} from "../../api/types";
import { ModelAdvisorCard } from "./ModelAdvisorCard";

vi.mock("../../api/hardware", () => ({
  getRecommendations: vi.fn(),
  runBenchmark: vi.fn(),
}));

const mockedRecs = vi.mocked(getRecommendations);
const mockedBench = vi.mocked(runBenchmark);

const profile: HardwareProfile = {
  scanned_at: "2026-07-05T10:00:00+00:00",
  os: "macOS 15.5 arm64",
  cpu_model: "Apple M3",
  cpu_cores: 8,
  ram_gb: 16,
  gpu_name: "Apple GPU",
  vram_gb: null,
  unified_memory: true,
  notes: [],
};

function mkModel(
  overrides: Partial<ModelRecommendation> = {},
): ModelRecommendation {
  return {
    name: "llama3.1:8b",
    installed: true,
    est_ram_gb: 7.5,
    rating: "good",
    recommended_for: [],
    size_bytes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelAdvisorCard", () => {
  it("renders rated rows with installed and recommended badges", async () => {
    mockedRecs.mockResolvedValue({
      profile,
      models: [
        mkModel({ recommended_for: ["chat"] }),
        mkModel({
          name: "qwen2.5:14b",
          installed: false,
          est_ram_gb: 12.6,
          rating: "heavy",
        }),
      ],
    });
    render(<ModelAdvisorCard />);

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText("llama3.1:8b")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("good")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("installed")).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText("recommended · chat"),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByText("~7.5 GB RAM")).toBeInTheDocument();

    expect(within(rows[1]!).getByText("heavy")).toBeInTheDocument();
    expect(within(rows[1]!).queryByText("installed")).not.toBeInTheDocument();
    // Only installed models can be benchmarked.
    expect(
      within(rows[1]!).queryByRole("button", { name: /benchmark/i }),
    ).not.toBeInTheDocument();
  });

  it("benchmarks one model at a time and reports the result inline", async () => {
    const user = userEvent.setup();
    mockedRecs.mockResolvedValue({
      profile,
      models: [mkModel(), mkModel({ name: "mistral:7b" })],
    });
    let resolveBench: (r: BenchmarkResponse) => void = () => {};
    mockedBench.mockReturnValue(
      new Promise<BenchmarkResponse>((resolve) => {
        resolveBench = resolve;
      }),
    );
    render(<ModelAdvisorCard />);

    const buttons = await screen.findAllByRole("button", {
      name: /benchmark/i,
    });
    await user.click(buttons[0]!);

    expect(mockedBench).toHaveBeenCalledWith({
      provider: "ollama",
      model: "llama3.1:8b",
    });
    // While one benchmark runs, every benchmark button is disabled.
    expect(screen.getByRole("button", { name: /running/i })).toBeDisabled();
    expect(buttons[1]!).toBeDisabled();

    resolveBench({
      ok: true,
      latency_ms: 820,
      chars: 5,
      chars_per_sec: 6.1,
      error: null,
    });
    expect(
      await screen.findByText("820 ms · 6.1 chars/s"),
    ).toBeInTheDocument();
    expect(buttons[1]!).toBeEnabled();
  });

  it("renders a failed benchmark's error inline", async () => {
    const user = userEvent.setup();
    mockedRecs.mockResolvedValue({ profile, models: [mkModel()] });
    mockedBench.mockResolvedValue({
      ok: false,
      latency_ms: 100,
      chars: 0,
      chars_per_sec: 0,
      error: "model not found",
    });
    render(<ModelAdvisorCard />);

    await user.click(
      await screen.findByRole("button", { name: /benchmark/i }),
    );

    expect(await screen.findByText("model not found")).toBeInTheDocument();
  });

  it("shows an inline message when recommendations fail to load", async () => {
    mockedRecs.mockRejectedValue(new Error("no config"));
    render(<ModelAdvisorCard />);
    expect(await screen.findByText("no config")).toBeInTheDocument();
  });
});

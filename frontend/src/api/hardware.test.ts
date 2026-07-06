import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import {
  getHardware,
  getRecommendations,
  runBenchmark,
  saveHardware,
} from "./hardware";
import type { HardwareProfile } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

function mkProfile(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    scanned_at: "2026-07-05T10:00:00+00:00",
    os: "macOS 15.5 arm64",
    cpu_model: "Apple M3",
    cpu_cores: 8,
    ram_gb: 16,
    gpu_name: "Apple M3",
    vram_gb: null,
    unified_memory: true,
    notes: [],
    ...overrides,
  };
}

describe("getHardware", () => {
  it("fetches the scan + saved profile", async () => {
    const spy = vi
      .spyOn(apiClient, "get")
      .mockResolvedValue({ profile: mkProfile(), saved: null });
    const res = await getHardware();
    expect(spy).toHaveBeenCalledWith("/api/hardware", undefined);
    expect(res.profile.cpu_model).toBe("Apple M3");
    expect(res.saved).toBeNull();
  });
});

describe("saveHardware", () => {
  it("posts the given profile wrapped in a body", async () => {
    const profile = mkProfile();
    const spy = vi
      .spyOn(apiClient, "post")
      .mockResolvedValue({ saved: profile });
    const res = await saveHardware(profile);
    expect(spy).toHaveBeenCalledWith(
      "/api/hardware/save",
      { profile },
      undefined,
    );
    expect(res.saved.ram_gb).toBe(16);
  });

  it("posts an empty body when no profile is supplied (backend re-scans)", async () => {
    const spy = vi
      .spyOn(apiClient, "post")
      .mockResolvedValue({ saved: mkProfile() });
    await saveHardware();
    expect(spy).toHaveBeenCalledWith("/api/hardware/save", {}, undefined);
  });
});

describe("getRecommendations", () => {
  it("fetches rated models with the profile", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue({
      profile: mkProfile(),
      models: [
        {
          name: "llama3.1:8b",
          installed: true,
          est_ram_gb: 7.5,
          rating: "good",
          recommended_for: ["chat"],
          size_bytes: 4_700_000_000,
        },
      ],
    });
    const res = await getRecommendations();
    expect(spy).toHaveBeenCalledWith("/api/hardware/recommendations", undefined);
    expect(res.models[0]!.rating).toBe("good");
  });
});

describe("runBenchmark", () => {
  it("posts the provider/model pair and returns inline results", async () => {
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue({
      ok: true,
      latency_ms: 820,
      chars: 5,
      chars_per_sec: 6.1,
      error: null,
    });
    const res = await runBenchmark({ provider: "ollama", model: "llama3.1:8b" });
    expect(spy).toHaveBeenCalledWith(
      "/api/hardware/benchmark",
      { provider: "ollama", model: "llama3.1:8b" },
      undefined,
      65_000,
    );
    expect(res.ok).toBe(true);
    expect(res.latency_ms).toBe(820);
  });
});

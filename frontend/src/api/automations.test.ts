import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import {
  generateStandup,
  getGitHubAutomation,
  getStandupAutomation,
  syncCalendar,
  syncGitHub,
  testCalendar,
  testGitHub,
  updateGitHubAutomation,
  updateStandupAutomation,
} from "./automations";

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

describe("automation API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and updates Standup automation", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({});
    vi.mocked(apiClient.patch).mockResolvedValue({});
    await getStandupAutomation();
    await updateStandupAutomation({ schedule: { enabled: true } });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/api/automations/standup",
      undefined,
    );
    expect(apiClient.patch).toHaveBeenCalledWith("/api/automations/standup", {
      schedule: { enabled: true },
    });
  });

  it("tests, syncs, and generates a selected date", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const controller = new AbortController();
    await testCalendar("2026-07-14", controller.signal);
    await syncCalendar("2026-07-14", controller.signal);
    await generateStandup("2026-07-14", controller.signal);
    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      "/api/automations/calendar/test",
      { date: "2026-07-14" },
      controller.signal,
      120_000,
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      "/api/automations/calendar/sync",
      { date: "2026-07-14" },
      controller.signal,
      120_000,
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      3,
      "/api/agents/standup/generate",
      { date: "2026-07-14" },
      controller.signal,
      120_000,
    );
  });

  it("loads and updates GitHub automation", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({});
    vi.mocked(apiClient.patch).mockResolvedValue({});
    await getGitHubAutomation();
    await updateGitHubAutomation({
      enabled: true,
      repos: ["octocat/hello-world"],
      interval_minutes: 30,
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      "/api/automations/github",
      undefined,
    );
    expect(apiClient.patch).toHaveBeenCalledWith("/api/automations/github", {
      enabled: true,
      repos: ["octocat/hello-world"],
      interval_minutes: 30,
    });
  });

  it("tests and syncs the GitHub bridge with the run timeout", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const controller = new AbortController();
    await testGitHub(controller.signal);
    await syncGitHub(controller.signal);
    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      "/api/automations/github/test",
      {},
      controller.signal,
      120_000,
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      "/api/automations/github/sync",
      {},
      controller.signal,
      120_000,
    );
  });
});

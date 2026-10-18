/*
Frontend testing conventions:
- Test files colocated next to source: Foo.tsx -> Foo.test.tsx
- Pure utility functions: utils.ts -> utils.test.ts
- Use Testing Library queries: getByRole > getByText > getByTestId (last resort)
- Mock HTTP via vi.fn() spies on the api client; NEVER hit real network
- Test behavior, not implementation: render, interact, assert visible output. Skip snapshot tests.
*/
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoomConfigPublic } from "../api/types";
import { ApiError } from "../api/client";
import { getConfig } from "../api/config";
import { completeOnboarding } from "../api/onboarding";
import { useLoomConfig } from "./useLoomConfig";

vi.mock("../api/config", () => ({ getConfig: vi.fn() }));
vi.mock("../api/onboarding", () => ({ completeOnboarding: vi.fn() }));

const getConfigMock = vi.mocked(getConfig);
const completeMock = vi.mocked(completeOnboarding);

function config(completed = true): LoomConfigPublic {
  return {
    active_vault: "default",
    default_provider: "openai",
    providers: {},
    ui: { theme: "midnight" },
    onboarding: { completed, completed_at: null, steps_done: [] },
  };
}

describe("useLoomConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock.mockResolvedValue(config());
  });

  it("loads the config and reports onboarding state", async () => {
    const { result } = renderHook(() => useLoomConfig());
    expect(result.current.configLoading).toBe(true);
    await waitFor(() => expect(result.current.configLoading).toBe(false));
    expect(result.current.config?.active_vault).toBe("default");
    expect(result.current.onboardingComplete).toBe(true);
    expect(result.current.offline).toBe(false);
  });

  it("marks the app offline when the backend is unreachable", async () => {
    getConfigMock.mockRejectedValue(new ApiError("unreachable", 0));
    const { result } = renderHook(() => useLoomConfig());
    await waitFor(() => expect(result.current.configLoading).toBe(false));
    expect(result.current.offline).toBe(true);
    expect(result.current.configError).toMatch(/unreachable/i);
  });

  it("surfaces other load errors without going offline", async () => {
    getConfigMock.mockRejectedValue(new ApiError("bad config", 500));
    const { result } = renderHook(() => useLoomConfig());
    await waitFor(() => expect(result.current.configError).toBe("bad config"));
    expect(result.current.offline).toBe(false);
  });

  it("completeOnboarding stores the returned config", async () => {
    getConfigMock.mockResolvedValue(config(false));
    completeMock.mockResolvedValue(config(true));
    const { result } = renderHook(() => useLoomConfig());
    await waitFor(() => expect(result.current.configLoading).toBe(false));
    expect(result.current.onboardingComplete).toBe(false);

    await act(async () => {
      await result.current.completeOnboarding({
        theme: "midnight",
        vault_name: "default",
        steps_done: [],
      });
    });
    expect(result.current.onboardingComplete).toBe(true);
  });
});

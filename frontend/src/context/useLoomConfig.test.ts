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
import type { LoomConfigPublic, ThemeName } from "../api/types";
import { getConfig, patchConfig } from "../api/config";
import { readInitialTheme } from "../theme/applyTheme";
import { useLoomConfig } from "./useLoomConfig";

vi.mock("../api/config", () => ({
  getConfig: vi.fn(),
  patchConfig: vi.fn(),
}));

const getConfigMock = vi.mocked(getConfig);
const patchConfigMock = vi.mocked(patchConfig);

function config(theme: ThemeName): LoomConfigPublic {
  return {
    active_vault: "default",
    default_provider: "openai",
    providers: {},
    ui: { theme },
    onboarding: { completed: true, completed_at: null, steps_done: [] },
  };
}

describe("useLoomConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.className = "";
    getConfigMock.mockResolvedValue(config("paper"));
    patchConfigMock.mockImplementation(async (patch) =>
      config(patch.theme ?? "paper"),
    );
  });

  it("readInitialTheme returns localStorage value when set, else default", () => {
    expect(readInitialTheme()).toBe("paper");

    localStorage.setItem("loom.theme", "navy");

    expect(readInitialTheme()).toBe("navy");
  });

  it("setTheme optimistically applies, then syncs with backend", async () => {
    const pushToast = vi.fn();
    const { result } = renderHook(() => useLoomConfig(pushToast));
    await waitFor(() => expect(result.current.configLoading).toBe(false));

    await act(async () => {
      await result.current.setTheme("forest");
    });

    expect(document.documentElement).toHaveClass("theme-forest");
    expect(localStorage.getItem("loom.theme")).toBe("forest");
    expect(patchConfigMock).toHaveBeenCalledWith({ theme: "forest" });
    expect(result.current.theme).toBe("forest");
  });

  it("fires a sync toast when backend theme differs from localStorage", async () => {
    localStorage.setItem("loom.theme", "navy");
    getConfigMock.mockResolvedValue(config("paper"));
    const pushToast = vi.fn();

    renderHook(() => useLoomConfig(pushToast));

    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Theme synced — switched to paper." }),
      ),
    );
    expect(document.documentElement).toHaveClass("theme-paper");
  });
});

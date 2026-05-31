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

    localStorage.setItem("loom.theme", "mulberry");

    expect(readInitialTheme()).toBe("mulberry");
  });

  it("setTheme optimistically applies, then syncs with backend", async () => {
    const pushToast = vi.fn();
    const { result } = renderHook(() => useLoomConfig(pushToast));
    await waitFor(() => expect(result.current.configLoading).toBe(false));

    await act(async () => {
      await result.current.setTheme("dune");
    });

    expect(document.documentElement).toHaveClass("theme-dune");
    expect(localStorage.getItem("loom.theme")).toBe("dune");
    expect(patchConfigMock).toHaveBeenCalledWith({ theme: "dune" });
    expect(result.current.theme).toBe("dune");
  });

  it("fires a sync toast when backend theme differs from localStorage", async () => {
    localStorage.setItem("loom.theme", "mulberry");
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

/** Controllable prefers-color-scheme: dark for the follow-OS path. */
function stubMatchMedia(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    flip(toDark: boolean) {
      mql.matches = toDark;
      for (const cb of listeners) cb({ matches: toDark } as MediaQueryListEvent);
    },
  };
}

describe("useLoomConfig — follow OS theme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.className = "";
    getConfigMock.mockResolvedValue(config("paper"));
    patchConfigMock.mockImplementation(async (patch) =>
      config(patch.theme ?? "paper"),
    );
  });

  it("resolves a dark theme on boot when following the OS in dark mode", async () => {
    localStorage.setItem("loom.theme", "paper"); // last theme was light
    localStorage.setItem("loom.theme.followOs", "1");
    stubMatchMedia(true); // OS prefers dark
    const { result } = renderHook(() => useLoomConfig(vi.fn()));

    // Boot resolves away from the light theme toward a dark one.
    await waitFor(() => expect(result.current.theme).not.toBe("paper"));
    expect(result.current.followOsTheme).toBe(true);
  });

  it("does not let the backend theme override while following the OS", async () => {
    localStorage.setItem("loom.theme.followOs", "1");
    stubMatchMedia(true);
    getConfigMock.mockResolvedValue(config("paper")); // server says light
    const { result } = renderHook(() => useLoomConfig(vi.fn()));

    await waitFor(() => expect(result.current.configLoading).toBe(false));
    // Server's "paper" must not win over the OS-resolved dark theme.
    expect(result.current.theme).not.toBe("paper");
  });

  it("switches theme when the OS preference flips", async () => {
    localStorage.setItem("loom.theme.followOs", "1");
    const media = stubMatchMedia(false); // start light
    const { result } = renderHook(() => useLoomConfig(vi.fn()));
    await waitFor(() => expect(result.current.configLoading).toBe(false));
    const lightTheme = result.current.theme;

    await act(async () => {
      media.flip(true); // OS goes dark
    });
    await waitFor(() => expect(result.current.theme).not.toBe(lightTheme));
  });

  it("a manual setTheme clears the follow-OS flag and sticks", async () => {
    // Start following in dark mode → resolves to a dark theme. Then manually
    // pick a light theme; with the flag cleared the OS must not pull it back.
    localStorage.setItem("loom.theme.followOs", "1");
    stubMatchMedia(true);
    const { result } = renderHook(() => useLoomConfig(vi.fn()));
    await waitFor(() => expect(result.current.followOsTheme).toBe(true));
    await waitFor(() => expect(result.current.theme).not.toBe("paper"));

    await act(async () => {
      await result.current.setTheme("paper");
    });
    expect(result.current.followOsTheme).toBe(false);
    expect(result.current.theme).toBe("paper");
    expect(localStorage.getItem("loom.theme.followOs")).toBeNull();
  });

  it("setFollowOsTheme(true) adopts the OS-appropriate theme", async () => {
    stubMatchMedia(true); // OS dark
    const { result } = renderHook(() => useLoomConfig(vi.fn()));
    await waitFor(() => expect(result.current.configLoading).toBe(false));
    expect(result.current.theme).toBe("paper"); // started light

    await act(async () => {
      result.current.setFollowOsTheme(true);
    });
    await waitFor(() => expect(result.current.theme).not.toBe("paper"));
    expect(result.current.followOsTheme).toBe(true);
  });
});

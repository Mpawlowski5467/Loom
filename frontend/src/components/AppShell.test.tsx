/*
Frontend testing conventions: render, assert visible output; prefer getByRole.
Mock heavy children (MainShell pulls Sigma/WebGL) so we can test phase logic.
*/
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decidePhase, useBootTimeout, BOOT_TIMEOUT_MS } from "./useBootTimeout";

// Stub the heavy phase targets so importing AppShell doesn't pull Sigma/WebGL.
vi.mock("./MainShell", () => ({
  MainShell: () => <div>main-shell</div>,
}));
vi.mock("../onboarding/OnboardingFlow", () => ({
  OnboardingFlow: () => <div>onboarding</div>,
}));

const { useApp } = vi.hoisted(() => ({ useApp: vi.fn() }));
vi.mock("../context/app-ctx", () => ({ useApp }));

// Imported after the mocks above are registered.
import { AppShell } from "./AppShell";

function appState(over: Record<string, unknown> = {}) {
  return {
    config: null,
    configLoading: false,
    offline: false,
    onboardingComplete: true,
    refreshConfig: vi.fn(),
    ...over,
  };
}

describe("decidePhase", () => {
  it("offline without config → ready (seeded UI)", () => {
    expect(
      decidePhase({
        config: false,
        configLoading: true,
        offline: true,
        onboardingComplete: false,
      }),
    ).toBe("ready");
  });

  it("loading config → loading, then timeout once timedOut", () => {
    const base = {
      config: false,
      configLoading: true,
      offline: false,
      onboardingComplete: true,
    };
    expect(decidePhase(base)).toBe("loading");
    expect(decidePhase({ ...base, timedOut: true })).toBe("timeout");
  });

  it("config present, not onboarded → onboarding", () => {
    expect(
      decidePhase({
        config: true,
        configLoading: false,
        offline: false,
        onboardingComplete: false,
      }),
    ).toBe("onboarding");
  });
});

describe("useBootTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flips true after the timeout while still booting", () => {
    const { result } = renderHook(() => useBootTimeout(true));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(BOOT_TIMEOUT_MS + 100);
    });
    expect(result.current).toBe(true);
  });

  it("never fires when not booting", () => {
    const { result } = renderHook(() => useBootTimeout(false));
    act(() => {
      vi.advanceTimersByTime(BOOT_TIMEOUT_MS + 100);
    });
    expect(result.current).toBe(false);
  });
});

describe("AppShell boot timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useApp.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("shows the spinner while loading, then a Retry fallback after 10s", () => {
    useApp.mockReturnValue(appState({ configLoading: true, config: null }));
    render(<AppShell />);

    // Spinner first (status role, no alert).
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(BOOT_TIMEOUT_MS + 100);
    });

    // Fallback now: alert + actionable Retry button instead of the spinner.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText(/Couldn.t reach the backend/i)).toBeInTheDocument();
  });

  it("Retry calls refreshConfig", () => {
    const refreshConfig = vi.fn();
    useApp.mockReturnValue(
      appState({ configLoading: true, config: null, refreshConfig }),
    );
    render(<AppShell />);
    act(() => {
      vi.advanceTimersByTime(BOOT_TIMEOUT_MS + 100);
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refreshConfig).toHaveBeenCalledTimes(1);
  });

  it("never times out when config has already arrived", () => {
    useApp.mockReturnValue(
      appState({ configLoading: false, config: { ok: true } }),
    );
    render(<AppShell />);
    act(() => {
      vi.advanceTimersByTime(BOOT_TIMEOUT_MS + 100);
    });
    // Onboarded + config → main shell; no alert ever.
    expect(screen.getByText("main-shell")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

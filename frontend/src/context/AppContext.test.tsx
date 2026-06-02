import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppContextValue } from "./app-ctx";
import type { UseLoomConfigResult } from "./useLoomConfig";
import { AppProvider } from "./AppContext";
import { useApp } from "./app-ctx";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    theme: "paper",
    setTheme: vi.fn(),
    followOsTheme: false,
    setFollowOsTheme: vi.fn(),
    config: null,
    configLoading: false,
    configError: null,
    offline: false,
    refreshConfig: vi.fn(),
    onboardingComplete: true,
    completeOnboarding: vi.fn(),
  } satisfies UseLoomConfigResult,
}));

vi.mock("./useLoomConfig", () => ({
  useLoomConfig: vi.fn(() => mockConfig),
}));

function Probe(): ReactNode {
  const { tab, setTab } = useApp();
  return (
    <>
      <div>tab:{tab}</div>
      <button onClick={() => setTab("settings")}>Open settings</button>
    </>
  );
}

describe("AppContext", () => {
  it("exposes default tab graph", () => {
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    expect(screen.getByText("tab:graph")).toBeInTheDocument();
  });

  it("setTab updates value", async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(screen.getByText("tab:settings")).toBeInTheDocument();
  });

  it("preserves the context value reference across an irrelevant re-render", async () => {
    const user = userEvent.setup();
    const seen: AppContextValue[] = [];

    function Capture(): ReactNode {
      seen.push(useApp());
      return null;
    }

    // A wrapper that re-renders AppProvider (new children element) on a state
    // bump that does NOT touch any provider state, so the memoized value must
    // stay referentially identical.
    function Harness(): ReactNode {
      const [, setN] = useState(0);
      return (
        <AppProvider>
          <Capture />
          <button onClick={() => setN((n) => n + 1)}>bump</button>
        </AppProvider>
      );
    }

    render(<Harness />);
    const before = seen.length;
    await user.click(screen.getByRole("button", { name: "bump" }));

    // A re-render happened (a new value snapshot was captured)...
    expect(seen.length).toBeGreaterThan(before);
    // ...but every captured value is the SAME object reference (memo held).
    expect(new Set(seen).size).toBe(1);
  });

  it("changes the context value reference when provider state changes", async () => {
    const user = userEvent.setup();
    const seen: AppContextValue[] = [];

    function Capture(): ReactNode {
      const ctx = useApp();
      seen.push(ctx);
      return (
        <button onClick={() => ctx.setTab("settings")}>change tab</button>
      );
    }

    render(
      <AppProvider>
        <Capture />
      </AppProvider>,
    );

    await user.click(screen.getByRole("button", { name: "change tab" }));

    // The value reference must change when a real dependency (tab) changes,
    // otherwise the memo would be stale.
    expect(seen[0]).not.toBe(seen[seen.length - 1]);
  });
});

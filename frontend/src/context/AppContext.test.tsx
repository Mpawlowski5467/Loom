import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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
});

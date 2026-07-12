import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    configLoading: true,
    configError: null,
    offline: false,
    refreshConfig: vi.fn(),
    onboardingComplete: false,
    completeOnboarding: vi.fn(),
  } satisfies UseLoomConfigResult,
}));

vi.mock("./useLoomConfig", () => ({
  useLoomConfig: vi.fn(() => mockConfig),
}));

function FixtureProbe(): ReactNode {
  const {
    notes,
    notesLoaded,
    treeVisible,
    offline,
    configLoading,
    graphFilters,
    toggleGraphFilter,
    graphDisplay,
    setGraphDisplay,
  } = useApp();
  return (
    <dl>
      <dt>notes</dt>
      <dd>{notes.length}</dd>
      <dt>first</dt>
      <dd>{notes[0]?.id ?? "none"}</dd>
      <dt>loaded</dt>
      <dd>{String(notesLoaded)}</dd>
      <dt>tree</dt>
      <dd>{String(treeVisible)}</dd>
      <dt>offline</dt>
      <dd>{String(offline)}</dd>
      <dt>config loading</dt>
      <dd>{String(configLoading)}</dd>
      <dt>filters</dt>
      <dd>{graphFilters.size}</dd>
      <dt>layout</dt>
      <dd>{graphDisplay.layout}</dd>
      <button type="button" onClick={() => toggleGraphFilter("daily")}>
        Change filters
      </button>
      <button type="button" onClick={() => setGraphDisplay({ layout: "wave" })}>
        Change display
      </button>
    </dl>
  );
}

describe("AppProvider graph fixture mode", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("loom.treeVisible", "true");
    localStorage.setItem("loom.graphFilters", JSON.stringify(["topic"]));
    localStorage.setItem(
      "loom.graphDisplay",
      JSON.stringify({ layout: "spiral", nodeSizeScale: 2 }),
    );
    window.history.replaceState({}, "", "/?graphFixture=500");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    localStorage.clear();
  });

  it("loads deterministic defaults without reading or changing real preferences", async () => {
    const storedFilters = localStorage.getItem("loom.graphFilters");
    const storedDisplay = localStorage.getItem("loom.graphDisplay");
    render(
      <AppProvider>
        <FixtureProbe />
      </AppProvider>,
    );

    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("perf-500-0000")).toBeInTheDocument();
    expect(screen.getAllByText("true")).toHaveLength(2);
    expect(screen.getAllByText("false")).toHaveLength(2);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("force")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Change display" }));

    await waitFor(() => expect(screen.getByText("wave")).toBeInTheDocument());
    expect(localStorage.getItem("loom.treeVisible")).toBe("true");
    expect(localStorage.getItem("loom.graphFilters")).toBe(storedFilters);
    expect(localStorage.getItem("loom.graphDisplay")).toBe(storedDisplay);
    expect(localStorage.getItem("loom.demoMode")).toBeNull();
  });
});

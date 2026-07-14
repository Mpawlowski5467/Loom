import { act, render, screen } from "@testing-library/react";
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

// AppProvider hydrates the vault on mount (notes, captures, council history,
// custom agents) and polls agent/health endpoints. Stub those network seams so
// mounting is deterministic and produces no late, test-confusing state churn.
// Stable references keep polling results from invalidating the memoized context
// value on every render.
const { EMPTY } = vi.hoisted(() => ({ EMPTY: [] as never[] }));

vi.mock("../api/notes", () => ({
  loadAllNotes: vi.fn(() => Promise.resolve([])),
  backendNotesToFrontend: vi.fn(() => []),
}));
vi.mock("../api/captures", () => ({
  listCaptures: vi.fn(() => Promise.resolve([])),
  backendCaptureToFrontend: vi.fn((capture: unknown) => capture),
}));
vi.mock("../api/chat", () => ({
  loadChatHistory: vi.fn(() => Promise.resolve({ messages: [] })),
  streamCouncilMessage: vi.fn(() => Promise.resolve()),
}));
vi.mock("../api/events", () => ({
  subscribeEventDomains: vi.fn(() => () => {}),
}));
vi.mock("../api/agentsRegistry", () => ({
  listAgentRegistry: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./useAgentPolling", () => ({
  useAgentPolling: vi.fn(() => ({ changelog: EMPTY, agentActivity: EMPTY })),
}));
vi.mock("./useHealthPolling", () => ({
  useHealthPolling: vi.fn(() => 0),
}));

function Probe(): ReactNode {
  const { tab, setTab, graphSelectedId, setGraphSelectedId } = useApp();
  return (
    <>
      <div>tab:{tab}</div>
      <button onClick={() => setTab("settings")}>Open settings</button>
      <div>selected:{graphSelectedId ?? "none"}</div>
      <button onClick={() => setGraphSelectedId("note-a")}>Select node</button>
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

  it("keeps persistent graph selection in context", async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Select node" }));
    expect(screen.getByText("selected:note-a")).toBeInTheDocument();
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
    // Let mount-time vault hydration settle so the captured value has stopped
    // changing for reasons unrelated to the re-render under test.
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const before = seen.length;
    const valueBefore = seen[seen.length - 1];
    await user.click(screen.getByRole("button", { name: "bump" }));

    // A re-render happened (a new value snapshot was captured)...
    expect(seen.length).toBeGreaterThan(before);
    // ...but the memoized value is the SAME object reference: the bump touched
    // no provider state, so consumers must not be handed a new object.
    expect(seen[seen.length - 1]).toBe(valueBefore);
  });

  it("changes the context value reference when provider state changes", async () => {
    const user = userEvent.setup();
    const seen: AppContextValue[] = [];

    function Capture(): ReactNode {
      const ctx = useApp();
      seen.push(ctx);
      return <button onClick={() => ctx.setTab("settings")}>change tab</button>;
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

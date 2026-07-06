/*
Frontend testing conventions: render, interact, assert visible output;
prefer getByRole. Mock the API module with vi.fn().
*/
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunFeed } from "./RunFeed";
import * as runsApi from "../api/runs";
import type { RunDetail, RunSummary } from "../api/runs";

// Stub the raw-call inspector so the test doesn't trigger its own fetch.
vi.mock("./TraceModal", () => ({
  TraceModal: ({ traceId }: { traceId: string }) => (
    <div data-testid="trace-modal">{traceId}</div>
  ),
}));

const RUN: RunSummary = {
  run_id: "run_1",
  agent: "researcher",
  status: "ok",
  started: "2026-06-06T10:00:00Z",
  ended: "2026-06-06T10:00:01Z",
  duration_ms: 12,
  steps: [
    { name: "search", status: "ok", duration_ms: 3, trace_ids: [], error: "" },
    { name: "synthesize", status: "ok", duration_ms: 9, trace_ids: ["trc_1"], error: "" },
  ],
};

const DETAIL: RunDetail = {
  ...RUN,
  traces: {
    search: [],
    synthesize: [
      {
        id: "trc_1",
        timestamp: "2026-06-06T10:00:01Z",
        provider: "stub",
        model: "stub-model",
        caller: "researcher",
        system: "",
        messages: [],
        response: "answer",
        duration_ms: 9,
        error: "",
        run_id: "run_1",
        step: "synthesize",
      },
    ],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RunFeed", () => {
  it("lists runs with their step arrow summary", async () => {
    vi.spyOn(runsApi, "listRuns").mockResolvedValue([RUN]);
    render(<RunFeed pollMs={100000} />);
    expect(await screen.findByText("researcher")).toBeInTheDocument();
    expect(screen.getByText("search → synthesize")).toBeInTheDocument();
  });

  it("expands a run into a step timeline and opens a leaf trace", async () => {
    vi.spyOn(runsApi, "listRuns").mockResolvedValue([RUN]);
    const fetchSpy = vi.spyOn(runsApi, "fetchRun").mockResolvedValue(DETAIL);
    const user = userEvent.setup();
    render(<RunFeed pollMs={100000} />);

    await user.click(await screen.findByRole("button", { name: /researcher/ }));
    expect(fetchSpy).toHaveBeenCalledWith("run_1");

    // The step timeline renders both step names.
    const timeline = await screen.findByRole("list", { name: /researcher run/ });
    expect(timeline).toHaveTextContent("search");
    expect(timeline).toHaveTextContent("synthesize");

    // The synthesize step exposes its LLM call; clicking it opens the inspector.
    await user.click(screen.getByRole("button", { name: /stub-model/ }));
    expect(await screen.findByTestId("trace-modal")).toHaveTextContent("trc_1");
  });

  it("shows an empty state when there are no runs", async () => {
    vi.spyOn(runsApi, "listRuns").mockResolvedValue([]);
    render(<RunFeed pollMs={100000} />);
    await waitFor(() =>
      expect(screen.getByText(/No runs yet/)).toBeInTheDocument(),
    );
  });

  it("filters to a single agent's runs when the agent prop is set", async () => {
    vi.spyOn(runsApi, "listRuns").mockResolvedValue([
      RUN,
      { ...RUN, run_id: "run_2", agent: "standup" },
    ]);
    render(<RunFeed agent="standup" pollMs={100000} />);

    expect(await screen.findByText("standup")).toBeInTheDocument();
    expect(screen.queryByText("researcher")).not.toBeInTheDocument();
  });

  it("shows the per-agent empty state when nothing matches the filter", async () => {
    vi.spyOn(runsApi, "listRuns").mockResolvedValue([RUN]);
    render(<RunFeed agent="my-agent" pollMs={100000} />);
    await waitFor(() =>
      expect(
        screen.getByText("No runs yet for this agent."),
      ).toBeInTheDocument(),
    );
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetailModal } from "./AgentDetailModal";
import type { Agent } from "../../data/types";
import type { RunSummary } from "../../api/runs";
import type { TraceSummary } from "../../api/traces";

const { getAgentRegistry, listRuns, listTraces } = vi.hoisted(() => ({
  getAgentRegistry: vi.fn(),
  listRuns: vi.fn(),
  listTraces: vi.fn(),
}));

vi.mock("../../api/agentsRegistry", () => ({ getAgentRegistry }));
vi.mock("../../api/runs", () => ({ listRuns, fetchRun: vi.fn() }));
vi.mock("../../api/traces", () => ({ listTraces }));
// TraceModal fetches its own trace; stub it so opening a call needs no HTTP.
vi.mock("../../components/TraceModal", () => ({
  TraceModal: ({ traceId }: { traceId: string }) => (
    <div data-testid="trace-modal">{traceId}</div>
  ),
}));

const AGENT: Agent = {
  id: "my-agent",
  name: "My Agent",
  layer: "shuttle",
  role: "Finds things",
  icon: "🔭",
  state: "idle",
  stats: { runs: 0, lastRun: "never" },
  lastAction: "—",
};

function mkRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: "run_1",
    agent: "my-agent",
    status: "ok",
    started: "2026-07-05T10:00:00Z",
    ended: "2026-07-05T10:00:01Z",
    duration_ms: 12,
    steps: [
      { name: "generate", status: "ok", duration_ms: 9, trace_ids: [], error: "" },
    ],
    ...overrides,
  };
}

function mkTrace(overrides: Partial<TraceSummary> = {}): TraceSummary {
  return {
    id: "trc_1",
    timestamp: "2026-07-05T10:00:00Z",
    provider: "stub",
    model: "stub-model",
    caller: "manual:my-agent",
    duration_ms: 9,
    error: "",
    response_preview: "hello",
    ...overrides,
  };
}

function renderModal(over: Partial<Parameters<typeof AgentDetailModal>[0]> = {}) {
  const onRun = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  render(
    <AgentDetailModal
      agent={AGENT}
      live={undefined}
      isCustom
      runnable
      running={false}
      onRun={onRun}
      onEdit={onEdit}
      onDelete={onDelete}
      onClose={onClose}
      pollMs={100000}
      {...over}
    />,
  );
  return { onRun, onEdit, onDelete, onClose };
}

beforeEach(() => {
  getAgentRegistry.mockReset().mockResolvedValue({
    id: "my-agent",
    name: "My Agent",
    layer: "shuttle",
    role: "Finds things",
    icon: "🔭",
    system_prompt: "You are My Agent, a careful scout.",
    system: false,
    provider: "openai",
    chat_model: "gpt-4o-mini",
  });
  listRuns.mockReset().mockResolvedValue([]);
  listTraces.mockReset().mockResolvedValue([]);
});

describe("AgentDetailModal", () => {
  it("fetches and shows the agent's instructions and model override", async () => {
    renderModal();

    expect(await screen.findByText("You are My Agent, a careful scout.")).toBeInTheDocument();
    expect(getAgentRegistry).toHaveBeenCalledWith("my-agent");
    expect(screen.getByText("Instructions")).toBeInTheDocument();
    expect(screen.getByText(/model: openai · gpt-4o-mini/)).toBeInTheDocument();
    expect(screen.getByText("custom")).toBeInTheDocument();
    expect(screen.getByText(/shuttle layer/)).toBeInTheDocument();
  });

  it("hides the model line when the record has no override", async () => {
    getAgentRegistry.mockResolvedValue({
      id: "my-agent",
      name: "My Agent",
      layer: "shuttle",
      role: "Finds things",
      icon: "🔭",
      system_prompt: "prompt",
      system: false,
      provider: "",
      chat_model: "",
    });
    renderModal();
    await screen.findByText("prompt");
    expect(screen.queryByText(/model:/)).not.toBeInTheDocument();
  });

  it("shows only this agent's runs and LLM calls", async () => {
    listRuns.mockResolvedValue([
      mkRun(),
      mkRun({ run_id: "run_2", agent: "researcher" }),
    ]);
    listTraces.mockResolvedValue([
      mkTrace(),
      mkTrace({ id: "trc_2", caller: "council:weaver", model: "other-model" }),
    ]);
    renderModal();

    const runsSection = await screen.findByRole("region", { name: "Recent runs" });
    await waitFor(() => expect(runsSection).toHaveTextContent("my-agent"));
    expect(runsSection).not.toHaveTextContent("researcher");

    const callsSection = screen.getByRole("region", { name: "Recent LLM calls" });
    await waitFor(() => expect(callsSection).toHaveTextContent("manual:my-agent"));
    expect(callsSection).not.toHaveTextContent("other-model");
  });

  it("opens the raw-call inspector when a call is clicked", async () => {
    listTraces.mockResolvedValue([mkTrace()]);
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole("button", { name: /stub-model/ }));
    expect(screen.getByTestId("trace-modal")).toHaveTextContent("trc_1");
  });

  it("wires the footer run / edit / delete actions", async () => {
    const user = userEvent.setup();
    const { onRun, onEdit, onDelete } = renderModal();
    await screen.findByText("You are My Agent, a careful scout.");

    await user.click(screen.getByRole("button", { name: "Run My Agent" }));
    expect(onRun).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Edit My Agent" }));
    expect(onEdit).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete My Agent" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("hides edit/delete for system agents and run when not runnable", async () => {
    renderModal({ isCustom: false, runnable: false });
    await screen.findByText("You are My Agent, a careful scout.");

    expect(
      screen.queryByRole("button", { name: "Run My Agent" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit My Agent" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("🔒 system")).toBeInTheDocument();
  });

  it("closes from the Close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

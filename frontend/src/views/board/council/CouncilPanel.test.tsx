import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import type { CouncilMessage } from "@/data/types";
import { CouncilPanel } from "./CouncilPanel";

vi.mock("@/components/TraceModal", () => ({
  TraceModal: ({ traceId }: { traceId: string }) => (
    <div role="dialog" aria-label="trace">
      {traceId}
    </div>
  ),
}));
vi.mock("@/components/CommitDetail", () => ({
  CommitDetail: ({ sha }: { sha: string }) => <p>diff of {sha}</p>,
}));
vi.mock("@/api/history", () => ({ revertCommit: vi.fn(async () => ({})) }));

const thread: CouncilMessage[] = [
  { id: "m1", who: "you", body: "What's stale?", at: "2026-05-16T09:00:00Z" },
  {
    id: "m2",
    who: "agent:council",
    body: "Two notes need a look: [[Caching]] and [[Webhooks]].",
    at: "2026-05-16T09:00:05Z",
    traceId: "trc_sum",
    contributions: [
      {
        agent: "archivist",
        body: "Caching hasn't changed in months.",
        traceId: "trc_a",
      },
      { agent: "spider", body: "", error: "timed out" },
    ],
    commits: [{ sha: "abc1234def", subject: "council: flagged stale notes" }],
  },
];

function renderPanel(over: Partial<AppContextValue> = {}) {
  const ctx = {
    council: thread,
    postCouncilMessage: vi.fn(async () => {}),
    councilPrefill: null,
    setCouncilPrefill: vi.fn(),
    ...over,
  } as unknown as AppContextValue;
  render(
    <AppCtx.Provider value={ctx}>
      <CouncilPanel />
    </AppCtx.Provider>,
  );
  return ctx;
}

describe("CouncilPanel", () => {
  it("shows your message, each agent's answer and the summary", () => {
    renderPanel();
    const panel = screen.getByRole("complementary", { name: "Loom Council" });
    expect(within(panel).getByText("What's stale?")).toBeInTheDocument();
    expect(within(panel).getByText("Archivist")).toBeInTheDocument();
    expect(
      within(panel).getByText("Caching hasn't changed in months."),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Couldn't answer: timed out"),
    ).toBeInTheDocument();
    const summary = within(panel).getByRole("region", {
      name: "Council summary",
    });
    expect(summary).toHaveTextContent(
      "Two notes need a look: Caching and Webhooks.",
    );
  });

  it("opens the diff of a change the Council made, and its raw calls", async () => {
    const user = userEvent.setup();
    renderPanel();
    const summary = screen.getByRole("region", { name: "Council summary" });
    await user.click(
      within(summary).getByRole("button", { name: "Open diff" }),
    );
    expect(await screen.findByText("diff of abc1234def")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "View Archivist's raw LLM call" }),
    );
    expect(screen.getByRole("dialog", { name: "trace" })).toHaveTextContent(
      "trc_a",
    );
  });

  it("offers no diff or undo when the reply changed nothing", () => {
    renderPanel({ council: [{ ...thread[1]!, commits: undefined }] } as never);
    expect(screen.queryByRole("button", { name: "Open diff" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("sends with Enter and keeps Shift+Enter for new lines", async () => {
    const user = userEvent.setup();
    const ctx = renderPanel({ council: [] } as never);
    expect(
      screen.getByText(/Ask the Council about your vault/),
    ).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Ask the Loom Council" });
    await user.type(box, "first{Shift>}{Enter}{/Shift}second{Enter}");
    expect(ctx.postCouncilMessage).toHaveBeenCalledWith("first\nsecond");
    expect(box).toHaveValue("");
  });

  it("starts from a prefilled question and blocks sends while answering", () => {
    renderPanel({
      council: [{ ...thread[1]!, pending: true, body: "" }],
      councilPrefill: "About [[Caching]]: ",
    } as never);
    const box = screen.getByRole("textbox", { name: "Ask the Loom Council" });
    expect(box).toHaveValue("About [[Caching]]: ");
    expect(box).toBeDisabled();
    expect(screen.getByText("The Council is discussing…")).toBeInTheDocument();
  });
});

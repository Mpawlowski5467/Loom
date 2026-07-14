import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "../../context/app-ctx";
import { ResearcherWorkspace } from "./ResearcherWorkspace";

const { createCapture, loadChatHistory, queryResearcher } = vi.hoisted(() => ({
  createCapture: vi.fn(),
  loadChatHistory: vi.fn(),
  queryResearcher: vi.fn(),
}));

vi.mock("../../api/chat", () => ({ loadChatHistory }));
vi.mock("../../api/captures", () => ({ createCapture }));
vi.mock("../../api/researcher", () => ({ queryResearcher }));

const previewResponse = {
  answer: "The answer is grounded in [[Alpha]].",
  referenced_notes: [
    {
      note_id: "note-alpha",
      title: "Alpha",
      path: "threads/topics/alpha.md",
      heading: "Decision",
      snippet: "Alpha records the decision and its rationale.",
      score: 0.86,
      type: "topic",
    },
  ],
  capture_id: "",
  capture_path: "",
  saved_to_inbox: false,
};

function renderWorkspace() {
  const openNote = vi.fn();
  const pushToast = vi.fn();
  const onClose = vi.fn();
  const value = {
    openNote,
    pushToast,
    resolveWikilink: (target: string) =>
      target.toLowerCase() === "alpha" ? "note-alpha" : undefined,
    noteById: () => ({ type: "topic", folder: "topics" }),
    setNewNoteOpen: vi.fn(),
    setNewNoteTitle: vi.fn(),
  } as unknown as AppContextValue;

  render(
    <AppCtx.Provider value={value}>
      <ResearcherWorkspace onClose={onClose} />
    </AppCtx.Provider>,
  );
  return { openNote, pushToast, onClose };
}

beforeEach(() => {
  loadChatHistory.mockReset().mockResolvedValue({
    agent: "researcher",
    messages: [],
  });
  createCapture.mockReset();
  queryResearcher.mockReset();
});

describe("ResearcherWorkspace", () => {
  it("loads existing one-to-one Researcher history", async () => {
    loadChatHistory.mockResolvedValue({
      agent: "researcher",
      messages: [
        {
          role: "user",
          content: "What did we decide?",
          timestamp: "2026-07-13T10:00:00Z",
          agent: "researcher",
        },
        {
          role: "assistant",
          content: "We chose the local-first approach.",
          timestamp: "2026-07-13T10:00:01Z",
          agent: "researcher",
        },
      ],
    });

    renderWorkspace();

    expect(await screen.findByText("What did we decide?")).toBeInTheDocument();
    expect(
      screen.getByText("We chose the local-first approach."),
    ).toBeInTheDocument();
    expect(loadChatHistory).toHaveBeenCalledWith("researcher", 40);
  });

  it("previews an answer with navigable wikilinks and evidence cards", async () => {
    queryResearcher.mockResolvedValue(previewResponse);
    const user = userEvent.setup();
    const { openNote } = renderWorkspace();

    const input = screen.getByRole("textbox", {
      name: "Question for Researcher",
    });
    await user.type(input, "Why did we choose Alpha?");
    await user.click(screen.getByRole("button", { name: "Ask Researcher" }));

    expect(
      await screen.findByText("The answer is grounded in", { exact: false }),
    ).toBeInTheDocument();
    expect(queryResearcher).toHaveBeenCalledWith(
      "Why did we choose Alpha?",
      expect.objectContaining({ saveCapture: false, persistChat: true }),
    );
    expect(queryResearcher).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Open source Alpha" }));
    expect(openNote).toHaveBeenCalledWith("note-alpha");

    await user.click(screen.getByRole("button", { name: "Open note Alpha" }));
    expect(openNote).toHaveBeenCalledWith("note-alpha");
    expect(screen.getByText("topic · Decision")).toBeInTheDocument();
    expect(screen.getByText("86%")).toBeInTheDocument();
  });

  it("does not write until Save to Inbox is explicitly chosen", async () => {
    queryResearcher.mockResolvedValueOnce(previewResponse);
    createCapture.mockResolvedValue({
      capture: {
        id: "cap-1",
        file_path: "/vault/threads/captures/research-cap-1.md",
      },
      created: true,
      deduplicated: false,
    });
    const user = userEvent.setup();
    const { pushToast } = renderWorkspace();

    await user.type(
      screen.getByRole("textbox", { name: "Question for Researcher" }),
      "Keep this answer",
    );
    await user.click(screen.getByRole("button", { name: "Ask Researcher" }));

    const save = await screen.findByRole("button", {
      name: "Save this research to Inbox",
    });
    expect(queryResearcher).toHaveBeenCalledTimes(1);
    expect(queryResearcher.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ saveCapture: false, persistChat: true }),
    );

    await user.click(save);

    await waitFor(() => expect(createCapture).toHaveBeenCalledTimes(1));
    expect(queryResearcher).toHaveBeenCalledTimes(1);
    expect(createCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Research: Keep this answer",
        source: "agent:researcher",
        external_id: expect.stringContaining("researcher-workspace:"),
        body: expect.stringContaining(
          "## Answer\n\nThe answer is grounded in [[Alpha]].",
        ),
      }),
      expect.any(AbortSignal),
    );
    expect(await screen.findByText("Saved to Inbox")).toBeInTheDocument();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "researcher",
        body: "Research saved to Inbox for Loom review",
      }),
    );
  });

  it("closes from the workspace close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderWorkspace();

    await user.click(
      screen.getByRole("button", { name: "Close Researcher workspace" }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCouncil } from "./useCouncil";

const { loadChatHistory, streamCouncilMessage } = vi.hoisted(() => ({
  loadChatHistory: vi.fn(),
  streamCouncilMessage: vi.fn(),
}));

vi.mock("../api/chat", () => ({ loadChatHistory, streamCouncilMessage }));

beforeEach(() => {
  loadChatHistory.mockReset().mockResolvedValue({ messages: [] });
  streamCouncilMessage.mockReset();
});

describe("useCouncil", () => {
  it("maps persisted history into the Council model", async () => {
    loadChatHistory.mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: "A stored answer",
          timestamp: "2026-08-14T10:00:00Z",
        },
      ],
    });
    const { result } = renderHook(() => useCouncil(false, []));

    await waitFor(() => expect(result.current.council).toHaveLength(1));
    expect(result.current.council[0]).toMatchObject({
      who: "agent:council",
      body: "A stored answer",
    });
  });

  it("streams a completed reply and clears its pending state", async () => {
    streamCouncilMessage.mockImplementation(
      async (_body: string, options: { onEvent: (event: unknown) => void }) => {
        options.onEvent({ kind: "token", chunk: "Draft" });
        options.onEvent({
          kind: "done",
          assistantText: "Final answer",
          traceId: "trace-1",
          contributions: [],
        });
      },
    );
    const { result } = renderHook(() => useCouncil(false, []));

    await act(async () => result.current.postCouncilMessage("Question"));

    expect(result.current.council).toHaveLength(2);
    expect(result.current.council[1]).toMatchObject({
      body: "Final answer",
      pending: false,
      traceId: "trace-1",
    });
  });
});

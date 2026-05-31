import { describe, it, expect, vi, afterEach } from "vitest";
import {
  streamCouncilMessage,
  loadChatHistory,
  type CouncilStreamEvent,
} from "./chat";
import { ApiError, apiClient } from "./client";

/** Build a Response whose body streams the given chunks of SSE text. */
function sseResponse(chunks: string[], init: Partial<Response> = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: stream,
    json: async () => ({}),
    ...init,
  } as unknown as Response;
}

function stubFetch(resp: Response | (() => Promise<Response>)) {
  const fn = vi.fn(typeof resp === "function" ? resp : async () => resp);
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Collect every event a stream emits into an array. */
async function collect(chunks: string[]): Promise<CouncilStreamEvent[]> {
  stubFetch(sseResponse(chunks));
  const events: CouncilStreamEvent[] = [];
  await streamCouncilMessage("hi", { onEvent: (e) => events.push(e) });
  return events;
}

describe("streamCouncilMessage — SSE parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a contributions frame", async () => {
    const data = JSON.stringify({
      agent_contributions: [
        { agent: "weaver", content: "take", trace_id: "t1", error: "" },
      ],
    });
    const events = await collect([`event: contributions\ndata: ${data}\n\n`]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "contributions",
      contributions: [
        { agent: "weaver", content: "take", trace_id: "t1", error: "" },
      ],
    });
  });

  it("parses token frames, JSON-unwrapping the chunk string", async () => {
    const events = await collect([
      `event: token\ndata: "hello"\n\n`,
      `event: token\ndata: " world"\n\n`,
    ]);
    expect(events).toEqual([
      { kind: "token", chunk: "hello" },
      { kind: "token", chunk: " world" },
    ]);
  });

  it("falls back to raw token data when it is not JSON", async () => {
    const events = await collect([`event: token\ndata: bare\n\n`]);
    expect(events).toEqual([{ kind: "token", chunk: "bare" }]);
  });

  it("parses a done frame into camelCased fields", async () => {
    const data = JSON.stringify({
      assistant_text: "final answer",
      trace_id: "trace-9",
      agent_contributions: [],
    });
    const events = await collect([`event: done\ndata: ${data}\n\n`]);
    expect(events[0]).toEqual({
      kind: "done",
      assistantText: "final answer",
      traceId: "trace-9",
      contributions: [],
    });
  });

  it("parses an error frame", async () => {
    const data = JSON.stringify({ message: "model exploded" });
    const events = await collect([`event: error\ndata: ${data}\n\n`]);
    expect(events[0]).toEqual({ kind: "error", message: "model exploded" });
  });

  it("ignores frames with no event field", async () => {
    const events = await collect([`data: orphan\n\n`]);
    expect(events).toEqual([]);
  });

  it("ignores unknown event types", async () => {
    const events = await collect([`event: heartbeat\ndata: {}\n\n`]);
    expect(events).toEqual([]);
  });

  it("reassembles a frame split across read chunks", async () => {
    // The "done" frame arrives in two TCP-style pieces.
    const data = JSON.stringify({
      assistant_text: "ok",
      trace_id: "t",
      agent_contributions: [],
    });
    const full = `event: done\ndata: ${data}\n\n`;
    const mid = Math.floor(full.length / 2);
    const events = await collect([full.slice(0, mid), full.slice(mid)]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "done", assistantText: "ok" });
  });

  it("flushes a trailing frame not terminated by a blank line", async () => {
    const events = await collect([`event: token\ndata: "tail"`]);
    expect(events).toEqual([{ kind: "token", chunk: "tail" }]);
  });

  it("emits events in arrival order across a full stream", async () => {
    const contrib = JSON.stringify({ agent_contributions: [] });
    const done = JSON.stringify({
      assistant_text: "A",
      trace_id: "t",
      agent_contributions: [],
    });
    const events = await collect([
      `event: contributions\ndata: ${contrib}\n\n`,
      `event: token\ndata: "A"\n\n`,
      `event: done\ndata: ${done}\n\n`,
    ]);
    expect(events.map((e) => e.kind)).toEqual([
      "contributions",
      "token",
      "done",
    ]);
  });
});

describe("streamCouncilMessage — errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws an ApiError with the server detail on a non-ok response", async () => {
    stubFetch(
      sseResponse([], {
        ok: false,
        status: 503,
        json: async () => ({ detail: "overloaded" }),
      } as Partial<Response>),
    );
    const err = await streamCouncilMessage("hi", { onEvent: () => {} }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.message).toBe("overloaded");
  });

  it("falls back to statusText when the error body has no detail", async () => {
    stubFetch(
      sseResponse([], {
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: async () => {
          throw new Error("no body");
        },
      } as Partial<Response>),
    );
    const err = await streamCouncilMessage("hi", { onEvent: () => {} }).catch(
      (e) => e,
    );
    expect(err.message).toBe("Server Error");
  });
});

describe("loadChatHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the council history by default", async () => {
    const spy = vi
      .spyOn(apiClient, "get")
      .mockResolvedValue({ agent: "_council", messages: [] });
    await loadChatHistory();
    expect(spy).toHaveBeenCalledWith(
      "/api/chat/history?agent=_council&limit=20",
    );
  });

  it("encodes the agent name and passes the limit", async () => {
    const spy = vi
      .spyOn(apiClient, "get")
      .mockResolvedValue({ agent: "a b", messages: [] });
    await loadChatHistory("a b", 5);
    expect(spy).toHaveBeenCalledWith("/api/chat/history?agent=a%20b&limit=5");
  });
});

import { ApiError, fetchTree, fetchGraph, fetchNote, createNote, searchNotes } from "../api";

const API_BASE = "http://localhost:8000";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  fn.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  } as Response);
  globalThis.fetch = fn;
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchTree", () => {
  it("calls GET /api/tree", async () => {
    const tree = { name: "threads", path: "/", is_dir: true, children: [] };
    const spy = mockFetch(tree);

    const result = await fetchTree();

    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/tree`);
    expect(init?.method).toBeUndefined(); // GET by default
    expect(result).toEqual(tree);
  });
});

describe("fetchGraph", () => {
  it("calls GET /api/graph without params", async () => {
    const graph = { nodes: [], edges: [] };
    const spy = mockFetch(graph);

    await fetchGraph();

    const [url] = spy.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/graph`);
  });

  it("appends type and tag as query params", async () => {
    const graph = { nodes: [], edges: [] };
    const spy = mockFetch(graph);

    await fetchGraph({ type: "project", tag: "work" });

    const [url] = spy.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/graph?type=project&tag=work`);
  });
});

describe("fetchNote", () => {
  it("calls GET /api/notes/:id", async () => {
    const note = { id: "thr_abc123", title: "Test" };
    const spy = mockFetch(note);

    await fetchNote("thr_abc123");

    const [url] = spy.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/notes/thr_abc123`);
  });

  it("encodes special characters in id", async () => {
    const spy = mockFetch({ id: "a/b" });

    await fetchNote("a/b");

    const [url] = spy.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/notes/a%2Fb`);
  });
});

describe("createNote", () => {
  it("sends POST /api/notes with JSON body", async () => {
    const created = { id: "thr_new001", title: "New Note" };
    const spy = mockFetch(created);

    const payload = { title: "New Note", type: "topic", tags: ["test"] };
    const result = await createNote(payload);

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`${API_BASE}/api/notes`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual(payload);
    expect(result).toEqual(created);
  });
});

describe("searchNotes", () => {
  it("sends q as a query param", async () => {
    const response = { query: "react", results: [], mode: "semantic" };
    const spy = mockFetch(response);

    await searchNotes("react");

    const [url] = spy.mock.calls[0];
    expect(url).toContain("/api/search?q=react");
  });

  it("includes optional type, tags, and context params", async () => {
    const response = { query: "react", results: [], mode: "keyword" };
    const spy = mockFetch(response);

    await searchNotes("react", { type: "topic", tags: "dev", context: "graph" });

    const [url] = spy.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("react");
    expect(parsed.searchParams.get("type")).toBe("topic");
    expect(parsed.searchParams.get("tags")).toBe("dev");
    expect(parsed.searchParams.get("context")).toBe("graph");
  });
});

describe("ApiError on non-ok response", () => {
  it("throws ApiError with status and detail from body", async () => {
    mockFetch({ detail: "Not found" }, 404);

    await expect(fetchNote("missing")).rejects.toThrow(ApiError);

    try {
      await fetchNote("missing");
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.detail).toBe("Not found");
    }
  });

  it("falls back to statusText when body has no detail", async () => {
    const fn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    fn.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("not json")),
    } as Response);
    globalThis.fetch = fn;

    try {
      await fetchTree();
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.detail).toBe("Internal Server Error");
    }
  });
});

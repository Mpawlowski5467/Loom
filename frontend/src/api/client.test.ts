import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient, ApiError, API_BASE } from "./client";

/** Build a Response-like stub for the global fetch mock. */
function mockResponse(opts: {
  status?: number;
  ok?: boolean;
  body?: string;
  statusText?: string;
}): Response {
  const status = opts.status ?? 200;
  return {
    status,
    ok: opts.ok ?? status < 400,
    statusText: opts.statusText ?? "",
    text: async () => opts.body ?? "",
  } as Response;
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("apiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a GET to the resolved base URL and parses JSON", async () => {
    const fetchFn = stubFetch(async () =>
      mockResponse({ body: JSON.stringify({ ok: true, n: 42 }) }),
    );
    const result = await apiClient.get<{ ok: boolean; n: number }>("/health");
    expect(result).toEqual({ ok: true, n: 42 });
    expect(fetchFn).toHaveBeenCalledWith(
      `${API_BASE}/health`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("prefixes a leading slash when the path lacks one", async () => {
    const fetchFn = stubFetch(async () => mockResponse({ body: "{}" }));
    await apiClient.get("health");
    expect(fetchFn).toHaveBeenCalledWith(`${API_BASE}/health`, expect.anything());
  });

  it("serializes the body and sets the JSON content-type on POST", async () => {
    const fetchFn = stubFetch(async () => mockResponse({ body: "{}" }));
    await apiClient.post("/notes", { title: "Hi" });
    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "Hi" }));
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("omits the content-type header when there is no body", async () => {
    const fetchFn = stubFetch(async () => mockResponse({ body: "{}" }));
    await apiClient.get("/health");
    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.headers).toEqual({});
    expect(init.body).toBeUndefined();
  });

  it("sends a raw body verbatim with the given content type on upload", async () => {
    const fetchFn = stubFetch(async () => mockResponse({ body: "{}" }));
    const blob = new Blob(["bytes"], { type: "application/gzip" });
    await apiClient.upload("/vaults/x/import", blob, "application/gzip");
    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(blob); // not JSON-stringified
    expect(init.headers).toEqual({ "Content-Type": "application/gzip" });
  });

  it("returns undefined for a 204 No Content response", async () => {
    stubFetch(async () => mockResponse({ status: 204, body: "" }));
    const result = await apiClient.delete("/notes/abc");
    expect(result).toBeUndefined();
  });

  it("returns the raw text when the body is not valid JSON", async () => {
    stubFetch(async () => mockResponse({ body: "plain text" }));
    const result = await apiClient.get<string>("/ping");
    expect(result).toBe("plain text");
  });

  it("maps a network failure to an offline ApiError (status 0)", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await apiClient.get("/health").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.offline).toBe(true);
  });

  it("re-throws AbortError without wrapping it", async () => {
    stubFetch(async () => {
      const e = new DOMException("aborted", "AbortError");
      throw e;
    });
    const err = await apiClient.get("/health").catch((e) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("throws an ApiError carrying status and the parsed body on a 4xx/5xx", async () => {
    stubFetch(async () =>
      mockResponse({
        status: 422,
        body: JSON.stringify({ detail: "Bad title" }),
      }),
    );
    const err = await apiClient.post("/notes", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Bad title");
    expect(err.body).toEqual({ detail: "Bad title" });
  });

  it("prefers `message` over `detail` when both are present", async () => {
    stubFetch(async () =>
      mockResponse({
        status: 400,
        body: JSON.stringify({ message: "explicit", detail: "fallback" }),
      }),
    );
    const err = await apiClient.get("/x").catch((e) => e);
    expect(err.message).toBe("explicit");
  });

  it("unwraps a nested detail.message object", async () => {
    stubFetch(async () =>
      mockResponse({
        status: 400,
        body: JSON.stringify({ detail: { message: "nested" } }),
      }),
    );
    const err = await apiClient.get("/x").catch((e) => e);
    expect(err.message).toBe("nested");
  });

  it("extracts an error code from the `error` field", async () => {
    stubFetch(async () =>
      mockResponse({
        status: 409,
        body: JSON.stringify({ error: "conflict", message: "Already exists" }),
      }),
    );
    const err = await apiClient.post("/x", {}).catch((e) => e);
    expect(err.code).toBe("conflict");
  });

  it("falls back to statusText when the error body has no message", async () => {
    stubFetch(async () =>
      mockResponse({ status: 500, statusText: "Server Error", body: "" }),
    );
    const err = await apiClient.get("/x").catch((e) => e);
    expect(err.message).toBe("Server Error");
  });

  it("passes an abort signal to fetch so the request is cancellable", async () => {
    const fetchFn = stubFetch(async () => mockResponse({ body: "{}" }));
    const controller = new AbortController();
    await apiClient.get("/health", controller.signal);
    // The signal handed to fetch is the composed timeout+caller signal, not the
    // caller's raw one — assert a signal is present rather than identity.
    expect(fetchFn.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the request when the caller's signal is already aborted", async () => {
    let seenAborted = false;
    stubFetch(async (_url, init) => {
      seenAborted = init.signal?.aborted ?? false;
      const e = new DOMException("aborted", "AbortError");
      throw e;
    });
    const controller = new AbortController();
    controller.abort();
    const err = await apiClient.get("/health", controller.signal).catch((e) => e);
    expect(seenAborted).toBe(true);
    // A caller abort surfaces as a raw AbortError, not a wrapped ApiError.
    expect((err as DOMException).name).toBe("AbortError");
    expect(err).not.toBeInstanceOf(ApiError);
  });

  it("maps a timeout to an offline ApiError with a timeout code", async () => {
    vi.useFakeTimers();
    try {
      // Fetch that rejects only when its signal aborts (simulates a hung
      // backend that never responds until the timeout fires).
      stubFetch(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const promise = apiClient
        .get("/slow", undefined)
        .catch((e) => e as ApiError);
      await vi.advanceTimersByTimeAsync(20_000);
      const err = await promise;
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(0);
      expect(err.code).toBe("timeout");
      expect(err.offline).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Thin fetch wrapper around the FastAPI backend.
 *
 * Centralises base URL, JSON encoding, and error normalisation so the
 * per-resource modules (config.ts / providers.ts / vault.ts / onboarding.ts)
 * stay tiny.
 */

const DEFAULT_BASE = "http://localhost:8000";

function resolveBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE as string | undefined;
  // An explicitly-set value wins — including an empty string, which means
  // "same origin" (relative ``/api`` paths). This is how the single-container
  // Docker build talks to its own backend regardless of host/port.
  if (typeof fromEnv === "string") return fromEnv.replace(/\/$/, "");
  return DEFAULT_BASE;
}

export const API_BASE = resolveBaseUrl();

/**
 * Normalised error from the API layer. ``status === 0`` means "could not
 * reach the backend at all" — the offline banner watches for this.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }

  get offline(): boolean {
    return this.status === 0;
  }
}

/**
 * Default per-request deadline. A backend that accepts the TCP connection but
 * never responds (a wedged uvicorn / half-dead container) would otherwise leave
 * the promise pending on the browser's multi-minute default — and self-
 * scheduling pollers that ``await`` the fetch would stall with no recovery.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Override the default timeout (ms). Pass 0 to disable (e.g. streaming). */
  timeoutMs?: number;
  /**
   * Raw request body (Blob/File/ArrayBuffer) sent verbatim with ``rawContentType``
   * instead of JSON-encoding ``body``. Used for binary uploads (e.g. vault
   * import tarballs). When set, ``body`` is ignored.
   */
  rawBody?: BodyInit;
  rawContentType?: string;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  // Compose a timeout controller with any caller signal so either can abort.
  // We track whether *we* aborted (timeout) vs the caller, so a deliberate
  // cancellation still surfaces as a raw AbortError (preserving existing
  // request-cancellation semantics) while a timeout becomes an ApiError.
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutCtrl = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          timeoutCtrl.abort();
        }, timeoutMs)
      : null;
  const onCallerAbort = () => timeoutCtrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) timeoutCtrl.abort();
    else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  const hasRaw = opts.rawBody !== undefined;
  const headers: Record<string, string> = hasRaw
    ? { "Content-Type": opts.rawContentType ?? "application/octet-stream" }
    : opts.body != null
      ? { "Content-Type": "application/json" }
      : {};

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: hasRaw
        ? opts.rawBody
        : opts.body != null
          ? JSON.stringify(opts.body)
          : undefined,
      signal: timeoutCtrl.signal,
    });
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") {
      // Our timeout fired — report it as an unreachable backend (status 0)
      // rather than a silent hang. A caller-initiated abort re-throws as-is.
      if (timedOut) {
        throw new ApiError(`Request timed out after ${timeoutMs}ms`, 0, "timeout");
      }
      throw err;
    }
    throw new ApiError(
      err instanceof Error ? err.message : "Network error",
      0,
    );
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(payload, response.statusText);
    const code = extractErrorCode(payload);
    throw new ApiError(message, response.status, code, payload);
  }

  return payload as T;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj["message"] === "string") return obj["message"] as string;
    if (typeof obj["detail"] === "string") return obj["detail"] as string;
    if (obj["detail"] && typeof obj["detail"] === "object") {
      const det = obj["detail"] as Record<string, unknown>;
      if (typeof det["message"] === "string") return det["message"] as string;
    }
  }
  return fallback || "Request failed";
}

function extractErrorCode(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj["error"] === "string") return obj["error"] as string;
  }
  return undefined;
}

export const apiClient = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: "GET", signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal, timeoutMs?: number) =>
    request<T>(path, { method: "POST", body, signal, timeoutMs }),
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: "PATCH", body, signal }),
  put: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: "PUT", body, signal }),
  delete: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: "DELETE", signal }),
  /**
   * POST a raw binary body (e.g. a tarball upload). Uses a longer deadline than
   * JSON calls since payloads can be large.
   */
  upload: <T>(
    path: string,
    rawBody: BodyInit,
    rawContentType?: string,
    signal?: AbortSignal,
  ) =>
    request<T>(path, {
      method: "POST",
      rawBody,
      rawContentType,
      signal,
      timeoutMs: 60_000,
    }),
};

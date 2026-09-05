import { apiClient } from "./client";
import type { CreateCaptureResponse } from "./captures";

export const clipUrl = (url: string, title = "", signal?: AbortSignal) =>
  apiClient.post<CreateCaptureResponse>(
    "/api/imports/url",
    { url, title },
    signal,
    60_000,
  );
export const importPdf = (file: File, title = "", signal?: AbortSignal) =>
  apiClient.upload<CreateCaptureResponse>(
    `/api/imports/pdf?title=${encodeURIComponent(title)}`,
    file,
    "application/pdf",
    signal,
  );

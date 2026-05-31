import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient } from "./client";
import {
  captureRelPath,
  backendCaptureToFrontend,
  previewCapture,
  type CaptureRecord,
} from "./captures";

function mkRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: "cap_1",
    title: "A capture",
    type: "capture",
    tags: [],
    created: "2026-05-01T00:00:00Z",
    modified: "2026-05-02T00:00:00Z",
    author: "user",
    source: "manual",
    status: "pending",
    preview: "preview text",
    body: "full body",
    file_path: "/home/u/.loom/vaults/main/threads/captures/cap_1.md",
    ...overrides,
  };
}

describe("captureRelPath", () => {
  it("returns the path relative to threads/ when filePath is set", () => {
    expect(
      captureRelPath({
        id: "cap_1",
        folder: "captures",
        filePath: "/x/.loom/vaults/main/threads/captures/cap_1.md",
      }),
    ).toBe("captures/cap_1.md");
  });

  it("falls back to folder/id when filePath has no threads/ segment", () => {
    expect(
      captureRelPath({ id: "cap_9", folder: "captures", filePath: "/weird/path.md" }),
    ).toBe("/weird/path.md");
  });

  it("synthesizes folder/id.md when filePath is empty", () => {
    expect(
      captureRelPath({ id: "cap_2", folder: "inbox", filePath: "" }),
    ).toBe("inbox/cap_2.md");
  });
});

describe("backendCaptureToFrontend", () => {
  it("maps a well-formed record straight across", () => {
    const cap = backendCaptureToFrontend(mkRecord());
    expect(cap).toEqual({
      id: "cap_1",
      title: "A capture",
      folder: "captures",
      body: "full body",
      receivedAt: "2026-05-01T00:00:00Z",
      status: "pending",
      filePath: "/home/u/.loom/vaults/main/threads/captures/cap_1.md",
    });
  });

  it("derives the folder from a nested path under threads/", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({
        file_path: "/v/threads/projects/loom/cap_x.md",
      }),
    );
    expect(cap.folder).toBe("projects/loom");
  });

  it("defaults the folder to captures when the path is flat", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({ file_path: "/v/threads/loose.md" }),
    );
    expect(cap.folder).toBe("captures");
  });

  it("falls back to the file path for a missing id", () => {
    const cap = backendCaptureToFrontend(mkRecord({ id: "", file_path: "/p/x.md" }));
    expect(cap.id).toBe("/p/x.md");
  });

  it("supplies a placeholder title when none is given", () => {
    expect(backendCaptureToFrontend(mkRecord({ title: "" })).title).toBe(
      "Untitled capture",
    );
  });

  it("uses the preview as the body when body is empty", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({ body: "", preview: "just a preview" }),
    );
    expect(cap.body).toBe("just a preview");
  });

  it("uses modified as the timestamp when created is absent", () => {
    const cap = backendCaptureToFrontend(
      mkRecord({ created: "", modified: "2026-05-02T00:00:00Z" }),
    );
    expect(cap.receivedAt).toBe("2026-05-02T00:00:00Z");
  });

  it("passes through done and processing statuses, normalizing the rest to pending", () => {
    expect(backendCaptureToFrontend(mkRecord({ status: "done" })).status).toBe("done");
    expect(
      backendCaptureToFrontend(mkRecord({ status: "processing" })).status,
    ).toBe("processing");
    expect(backendCaptureToFrontend(mkRecord({ status: "garbage" })).status).toBe(
      "pending",
    );
    expect(backendCaptureToFrontend(mkRecord({ status: "" })).status).toBe("pending");
  });
});

describe("previewCapture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unwraps the preview field from the response envelope", async () => {
    const preview = {
      note_type: "topic",
      folder: "topics",
      title: "T",
      tags: [],
      body: "b",
      links: [],
    };
    const spy = vi
      .spyOn(apiClient, "post")
      .mockResolvedValue({ preview });
    const result = await previewCapture({ capture_path: "captures/cap_1.md" });
    expect(result).toEqual(preview);
    expect(spy).toHaveBeenCalledWith(
      "/api/captures/preview",
      { capture_path: "captures/cap_1.md" },
      undefined,
    );
  });

  it("returns null for an empty capture", async () => {
    vi.spyOn(apiClient, "post").mockResolvedValue({ preview: null });
    const result = await previewCapture({ capture_path: "captures/empty.md" });
    expect(result).toBeNull();
  });
});

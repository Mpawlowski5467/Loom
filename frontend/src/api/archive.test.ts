import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient } from "./client";
import { listArchivedNotes, restoreArchivedNote } from "./archive";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listArchivedNotes", () => {
  it("GETs the archive endpoint and returns the listing", async () => {
    const payload = {
      notes: [
        {
          id: "thr_aaa111",
          title: "Python",
          type: "topic",
          original_path: "topics/python.md",
          archived_at: "2026-06-01T00:00:00Z",
        },
      ],
    };
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue(payload);

    const result = await listArchivedNotes();
    expect(result).toEqual(payload);
    expect(spy).toHaveBeenCalledWith("/api/archive", undefined);
  });

  it("threads an abort signal through to the client", async () => {
    const spy = vi.spyOn(apiClient, "get").mockResolvedValue({ notes: [] });
    const ctrl = new AbortController();
    await listArchivedNotes(ctrl.signal);
    expect(spy).toHaveBeenCalledWith("/api/archive", ctrl.signal);
  });
});

describe("restoreArchivedNote", () => {
  it("POSTs to the restore endpoint with the id encoded", async () => {
    const restored = { id: "thr_aaa111", status: "active" };
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue(restored);

    const result = await restoreArchivedNote("thr_aaa111");
    expect(result).toEqual(restored);
    expect(spy).toHaveBeenCalledWith("/api/archive/thr_aaa111/restore");
  });

  it("encodes ids that contain URL-special characters", async () => {
    const spy = vi.spyOn(apiClient, "post").mockResolvedValue({});
    await restoreArchivedNote("thr a/b");
    expect(spy).toHaveBeenCalledWith("/api/archive/thr%20a%2Fb/restore");
  });

  it("propagates a rejected restore (e.g. 409 path occupied)", async () => {
    vi.spyOn(apiClient, "post").mockRejectedValue(new Error("already exists"));
    await expect(restoreArchivedNote("thr_aaa111")).rejects.toThrow(
      "already exists",
    );
  });
});

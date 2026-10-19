import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "./client";
import { listCaptureProposals } from "./proposals";

afterEach(() => vi.restoreAllMocks());

describe("listCaptureProposals", () => {
  it("indexes stored proposals by capture id", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue([
      { capture_id: "c1", ready: true, precheck: [] },
    ]);
    const map = await listCaptureProposals([]);
    expect(map?.get("c1")).toEqual({
      capture_id: "c1",
      ready: true,
      precheck: [],
    });
  });

  it("returns null when the backend has no proposals endpoint", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(new ApiError("nope", 404));
    expect(await listCaptureProposals([])).toBeNull();
  });
});

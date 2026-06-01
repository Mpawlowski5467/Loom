/*
Frontend testing conventions:
- Mock HTTP via vi.fn() spies on the api client; NEVER hit real network
- Test behavior, not implementation: render, assert observable output.
*/
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthResponse } from "../api/diagnostics";
import { getHealth } from "../api/diagnostics";
import { useHealthPolling } from "./useHealthPolling";

vi.mock("../api/diagnostics", () => ({
  getHealth: vi.fn(),
}));

const getHealthMock = vi.mocked(getHealth);

function health(unindexed: number | undefined): HealthResponse {
  return {
    ok: true,
    components: {
      indexer: { ready: true, unindexed },
    },
  };
}

describe("useHealthPolling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces the indexer's unindexed count when enabled", async () => {
    getHealthMock.mockResolvedValue(health(4));
    const { result } = renderHook(() => useHealthPolling(true));

    await waitFor(() => expect(result.current).toBe(4));
    expect(getHealthMock).toHaveBeenCalled();
  });

  it("reports 0 when the field is absent", async () => {
    getHealthMock.mockResolvedValue(health(undefined));
    const { result } = renderHook(() => useHealthPolling(true));

    // Give the resolved promise a tick; count stays at its 0 default.
    await waitFor(() => expect(getHealthMock).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });

  it("does not poll when disabled", () => {
    renderHook(() => useHealthPolling(false));
    expect(getHealthMock).not.toHaveBeenCalled();
  });

  it("stays at 0 when the backend is unreachable", async () => {
    getHealthMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useHealthPolling(true));

    await waitFor(() => expect(getHealthMock).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });
});

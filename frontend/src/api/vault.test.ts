import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient, API_BASE } from "./client";
import { importVault, vaultExportUrl } from "./vault";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vaultExportUrl", () => {
  it("builds an absolute export URL with the name encoded", () => {
    expect(vaultExportUrl("my vault")).toBe(
      `${API_BASE}/api/vaults/my%20vault/export`,
    );
  });
});

describe("importVault", () => {
  it("uploads the tarball as gzip to the import endpoint", async () => {
    const spy = vi
      .spyOn(apiClient, "upload")
      .mockResolvedValue({ name: "demo", path: "/v/demo", is_active: false });
    const blob = new Blob(["bytes"], { type: "application/gzip" });

    const result = await importVault("demo", blob);

    expect(result).toEqual({ name: "demo", path: "/v/demo", is_active: false });
    expect(spy).toHaveBeenCalledWith(
      "/api/vaults/demo/import",
      blob,
      "application/gzip",
      undefined,
    );
  });

  it("appends ?overwrite=true and encodes the name when overwriting", async () => {
    const spy = vi.spyOn(apiClient, "upload").mockResolvedValue({});
    const blob = new Blob(["bytes"]);

    await importVault("my vault", blob, true);

    expect(spy).toHaveBeenCalledWith(
      "/api/vaults/my%20vault/import?overwrite=true",
      blob,
      "application/gzip",
      undefined,
    );
  });
});

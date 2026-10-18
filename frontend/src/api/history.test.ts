import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { getCommitDiff, listHistory, notePath, revertCommit } from "./history";

afterEach(() => vi.restoreAllMocks());

it("builds vault-relative note paths for root and nested folders", () => {
  expect(notePath("topics/ml", "raft.md")).toBe("threads/topics/ml/raft.md");
  expect(notePath("", "inbox.md")).toBe("threads/inbox.md");
});

it("sends only the filters that are set", async () => {
  const get = vi.spyOn(apiClient, "get").mockResolvedValue([]);
  await listHistory({ path: "threads/topics/a b.md", agent: "spider" });
  await listHistory();
  expect(get).toHaveBeenNthCalledWith(
    1,
    "/api/history?path=threads%2Ftopics%2Fa+b.md&agent=spider",
  );
  expect(get).toHaveBeenNthCalledWith(2, "/api/history");
});

it("encodes the commit id for diff and revert", async () => {
  const get = vi.spyOn(apiClient, "get").mockResolvedValue({});
  const post = vi.spyOn(apiClient, "post").mockResolvedValue({});
  await getCommitDiff("abc123");
  await revertCommit("abc123");
  expect(get).toHaveBeenCalledWith("/api/history/abc123/diff");
  expect(post).toHaveBeenCalledWith("/api/history/abc123/revert", {});
});

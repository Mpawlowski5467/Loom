import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { queryResearcher } from "./researcher";

describe("queryResearcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("previews without writing to Inbox by default", async () => {
    const response = {
      answer: "Grounded answer",
      referenced_notes: [],
      capture_id: "",
      capture_path: "",
      saved_to_inbox: false,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(response);

    await expect(queryResearcher("What changed?")).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith(
      "/api/agents/researcher/query",
      {
        question: "What changed?",
        save_capture: false,
        persist_chat: false,
      },
      undefined,
      120_000,
    );
  });

  it("only requests a capture when explicitly asked", async () => {
    const response = {
      answer: "Saved answer",
      referenced_notes: [],
      capture_id: "cap_1",
      capture_path: "threads/captures/research-cap_1.md",
      saved_to_inbox: true,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(response);
    const controller = new AbortController();

    await queryResearcher("Keep this", {
      saveCapture: true,
      signal: controller.signal,
    });

    expect(post).toHaveBeenCalledWith(
      "/api/agents/researcher/query",
      { question: "Keep this", save_capture: true, persist_chat: false },
      controller.signal,
      120_000,
    );
  });

  it("can persist a structured workspace turn without saving a capture", async () => {
    const response = {
      answer: "Preview",
      referenced_notes: [],
      capture_id: "",
      capture_path: "",
      saved_to_inbox: false,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(response);

    await queryResearcher("Remember this turn", { persistChat: true });

    expect(post).toHaveBeenCalledWith(
      "/api/agents/researcher/query",
      {
        question: "Remember this turn",
        save_capture: false,
        persist_chat: true,
      },
      undefined,
      120_000,
    );
  });
});

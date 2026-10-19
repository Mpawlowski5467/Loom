import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanNoteWithSpider } from "@/api/agents";
import { createCapture } from "@/api/captures";
import { ApiError } from "@/api/client";
import { searchVault, type VaultSearch } from "@/api/search";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import { supersessionSeed } from "@/data/notesSupersession";
import type { Note } from "@/data/types";
import { detectCommunities } from "@/graph/communities";
import { CommandPalette } from "./CommandPalette";

vi.mock("@/api/search", async (orig) => ({
  ...(await orig<typeof import("@/api/search")>()),
  searchVault: vi.fn(),
}));
vi.mock("@/api/captures", async (orig) => ({
  ...(await orig<typeof import("@/api/captures")>()),
  createCapture: vi.fn(async () => ({})),
}));
vi.mock("@/api/agents", async (orig) => ({
  ...(await orig<typeof import("@/api/agents")>()),
  scanNoteWithSpider: vi.fn(async () => ({
    notes_scanned: 1,
    total_auto_linked: 2,
    total_suggested: 1,
    total_skipped: 0,
  })),
}));
vi.mock("@/api/agentsRegistry", () => ({
  listAgentRegistry: vi.fn(async () => {
    throw new Error("offline");
  }),
}));
vi.mock("@/api/activity", () => ({
  fetchAgentActivity: vi.fn(async () => []),
}));

const [v1, v2, budget] = supersessionSeed as [Note, Note, Note];
const notes = [v1, v2, budget];

function result(over: Partial<VaultSearch> = {}): VaultSearch {
  return {
    query: "cache",
    mode: "hybrid",
    tookMs: 12,
    timing: "server",
    hits: [v2, v1].map((n) => ({
      noteId: n.id,
      title: n.title,
      type: n.type,
      tags: n.tags,
      snippet: "Second plan for the read cache.",
      heading: "Rollout",
      score: 0.03,
      match: {
        keyword: { rank: 1, score: 0.75 },
        semantic: { chunk: "read cache", heading: "Rollout", score: 0.6 },
      },
    })),
    ...over,
  };
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output aria-label="Location">{pathname + search}</output>;
}

function renderPalette(over: Partial<AppContextValue> = {}) {
  const ctx = {
    notes,
    noteById: (id: string) => notes.find((n) => n.id === id),
    communities: detectCommunities(notes),
    tab: "graph",
    currentNoteId: null,
    graphSelectedId: null,
    setPaletteOpen: vi.fn(),
    openNote: vi.fn(),
    flyToNode: vi.fn(),
    pushToast: vi.fn(),
    setCouncilPrefill: vi.fn(),
    setTab: vi.fn(),
    setNewNoteOpen: vi.fn(),
    setQuickCaptureOpen: vi.fn(),
    ...over,
  } as unknown as AppContextValue;
  render(
    <MemoryRouter initialEntries={["/graph"]}>
      <AppCtx.Provider value={ctx}>
        <CommandPalette />
        <LocationProbe />
      </AppCtx.Provider>
    </MemoryRouter>,
  );
  return ctx;
}

const input = () =>
  screen.getByRole("combobox", { name: "Search notes, actions and agents" });

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(searchVault).mockResolvedValue(result());
  });

  it("starts with recent notes, actions and agents", () => {
    renderPalette();
    expect(screen.getByText("Recent notes")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /New note/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Spider/ })).toBeInTheDocument();
    const preview = screen.getByRole("complementary", { name: "Preview" });
    expect(
      within(preview).getByRole("heading", { level: 3 }),
    ).toHaveTextContent("Cache plan v2");
  });

  it("searches, times the request and explains the top match", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(input(), "cache");
    expect(await screen.findByText("hybrid · 12 ms")).toBeInTheDocument();
    expect(searchVault).toHaveBeenCalledWith(
      "cache",
      expect.objectContaining({ context: null, includeSuperseded: false }),
    );
    const option = screen.getByRole("option", { name: /^Cache plan v2/ });
    expect(within(option).getByText("Cache")).toContainHTML("mark");
    const preview = screen.getByRole("complementary", { name: "Preview" });
    expect(within(preview).getByText("Why it matched")).toBeInTheDocument();
    expect(within(preview).getByText("0.75")).toBeInTheDocument();
    expect(within(preview).getByText("## Rollout")).toBeInTheDocument();
  });

  it("opens the focused note, or shows it in the graph with ⌥↵", async () => {
    const user = userEvent.setup();
    const ctx = renderPalette();
    await user.type(input(), "cache");
    await screen.findByText("hybrid · 12 ms");
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    expect(ctx.flyToNode).toHaveBeenCalledWith(v2.id);
    await user.keyboard("{Enter}");
    expect(ctx.openNote).toHaveBeenCalledWith(v2.id);
    expect(ctx.setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("captures the query with ⇧↵", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(input(), "remember the cache{Shift>}{Enter}{/Shift}");
    await waitFor(() =>
      expect(createCapture).toHaveBeenCalledWith({
        title: "remember the cache",
        body: "remember the cache",
        source: "manual:palette",
      }),
    );
  });

  it("toggles superseded notes with ⌥S", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(input(), "cache");
    await screen.findByText("hybrid · 12 ms");
    expect(screen.queryByRole("option", { name: /Cache plan v1/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Superseded hidden \(1\)/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Alt>}s{/Alt}");
    expect(input()).toHaveValue("cache");
    expect(
      await screen.findByRole("option", { name: /Cache plan v1/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(searchVault).toHaveBeenLastCalledWith(
        "cache",
        expect.objectContaining({ includeSuperseded: true }),
      ),
    );
  });

  it("filters to a group with the chips", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole("radio", { name: "Agents" }));
    expect(screen.queryByText("Recent notes")).toBeNull();
    expect(screen.getByRole("option", { name: /Spider/ })).toBeInTheDocument();
  });

  it("falls back to title matching when search is unavailable", async () => {
    vi.mocked(searchVault).mockRejectedValue(new ApiError("down", 0, true));
    const user = userEvent.setup();
    renderPalette();
    await user.type(input(), "latency");
    expect(
      await screen.findByText("offline · titles only"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /^Latency budget/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Matching titles and tags instead/,
    );
  });

  it("asks before running Spider on the open note", async () => {
    const user = userEvent.setup();
    const ctx = renderPalette({
      tab: "notes",
      currentNoteId: budget.id,
    } as never);
    await user.click(
      screen.getByRole("option", { name: /Run Spider on Latency budget/ }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Run Spider on Latency budget?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Run Spider" }),
    );
    await waitFor(() =>
      expect(scanNoteWithSpider).toHaveBeenCalledWith(budget.id),
    );
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Spider scanned 1 notes, auto-linked 2, suggested 1",
      }),
    );
  });

  it("opens an agent on Board", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(input(), "spider");
    await user.click(
      await screen.findByRole("option", { name: /Spider.*auto-links/i }),
    );
    expect(
      screen.getByRole("status", { name: "Location", hidden: true }),
    ).toHaveTextContent("/board?agent=spider");
  });
});

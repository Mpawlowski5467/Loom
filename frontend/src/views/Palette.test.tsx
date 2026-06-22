import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppCtx, type AppContextValue } from "../context/app-ctx";
import { Palette } from "./Palette";
import type { Note } from "../data/types";
import type { SearchResult } from "../api/search";
import { ApiError } from "../api/client";

// --- Mock the search API: Palette reads `recentNotes` (for the empty query) and
// drives all backend search through `searchNotesRemote`. Stub both so no network
// is touched; keep the module's real types. ---
const { recentNotes, searchNotesRemote } = vi.hoisted(() => ({
  recentNotes: vi.fn(),
  searchNotesRemote: vi.fn(),
}));

vi.mock("../api/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/search")>();
  return { ...actual, recentNotes, searchNotesRemote };
});

function mkNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    type: "topic",
    folder: "topics",
    tags: [],
    body: "",
    links: [],
    history: [],
    created: "2026-05-01T00:00:00Z",
    modified: "2026-05-01T00:00:00Z",
    status: "active",
    source: "manual",
    ...overrides,
  };
}

function mkResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    note_id: "thr_1",
    title: "Result Title",
    heading: "",
    snippet: "a snippet",
    score: 0.42,
    type: "topic",
    ...overrides,
  };
}

interface Spies {
  openNote: ReturnType<typeof vi.fn>;
  flyToNode: ReturnType<typeof vi.fn>;
  setPaletteOpen: ReturnType<typeof vi.fn>;
}

function renderPalette(notes: Note[] = [mkNote("a")]): Spies {
  const spies: Spies = {
    openNote: vi.fn(),
    flyToNode: vi.fn(),
    setPaletteOpen: vi.fn(),
  };

  const value = {
    notes,
    ...spies,
  } as unknown as AppContextValue;

  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <Palette />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return spies;
}

/** The search input is the combobox; typing here drives the debounced search. */
function input(): HTMLElement {
  return screen.getByRole("combobox");
}

beforeEach(() => {
  recentNotes.mockReset();
  searchNotesRemote.mockReset();
  // Default: a single recent note for the empty-query state.
  recentNotes.mockReturnValue([
    mkResult({ note_id: "recent_1", title: "Recent Note", score: 0 }),
  ]);
  // Default: search never settles unless a test opts in.
  searchNotesRemote.mockReturnValue(new Promise(() => {}));
});

describe("Palette — recent (empty query)", () => {
  it("shows the recent notes and the `recent` foot label with an empty query", () => {
    renderPalette();
    expect(screen.getByRole("option", { name: /Recent Note/ })).toBeInTheDocument();
    expect(screen.getByText("recent")).toBeInTheDocument();
    // No backend call for the empty query.
    expect(searchNotesRemote).not.toHaveBeenCalled();
  });
});

describe("Palette — remote search", () => {
  it("runs the debounced backend search and renders the returned results", async () => {
    const user = userEvent.setup();
    searchNotesRemote.mockResolvedValue([
      mkResult({ note_id: "thr_hit", title: "Caching Strategy", score: 0.91 }),
    ]);
    renderPalette();

    await user.type(input(), "  cache  ");

    // Debounced search fires with the trimmed query.
    await waitFor(() => expect(searchNotesRemote).toHaveBeenCalled());
    expect(searchNotesRemote).toHaveBeenCalledWith(
      "cache",
      expect.any(Number),
      expect.any(AbortSignal),
    );

    // Result title + score become visible.
    const option = await screen.findByRole("option", { name: /Caching Strategy/ });
    expect(option).toBeInTheDocument();
    expect(within(option).getByText("0.91")).toBeInTheDocument();
    expect(screen.getByText("backend search")).toBeInTheDocument();
  });

  it("renders the offline state when the backend search rejects", async () => {
    const user = userEvent.setup();
    searchNotesRemote.mockRejectedValue(new ApiError("backend down", 503));
    renderPalette();

    await user.type(input(), "cache");

    expect(
      await screen.findByText(/search unavailable — backend offline/),
    ).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });
});

describe("Palette — keyboard navigation", () => {
  it("ArrowDown / ArrowUp move the active selection", async () => {
    const user = userEvent.setup();
    searchNotesRemote.mockResolvedValue([
      mkResult({ note_id: "r0", title: "First" }),
      mkResult({ note_id: "r1", title: "Second" }),
      mkResult({ note_id: "r2", title: "Third" }),
    ]);
    renderPalette();

    await user.type(input(), "x");
    await screen.findByRole("option", { name: /First/ });

    const optByTitle = (t: string) =>
      screen.getByRole("option", { name: new RegExp(t) });

    // Default selection is the first option.
    expect(optByTitle("First")).toHaveAttribute("aria-selected", "true");
    expect(input()).toHaveAttribute("aria-activedescendant", "palette-opt-0");

    await user.keyboard("{ArrowDown}");
    expect(optByTitle("Second")).toHaveAttribute("aria-selected", "true");
    expect(optByTitle("First")).toHaveAttribute("aria-selected", "false");
    expect(input()).toHaveAttribute("aria-activedescendant", "palette-opt-1");

    await user.keyboard("{ArrowDown}");
    expect(optByTitle("Third")).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}");
    expect(optByTitle("Second")).toHaveAttribute("aria-selected", "true");
  });
});

describe("Palette — activation", () => {
  it("Enter opens the selected note and closes the palette", async () => {
    const user = userEvent.setup();
    searchNotesRemote.mockResolvedValue([
      mkResult({ note_id: "r0", title: "First" }),
      mkResult({ note_id: "r1", title: "Second" }),
    ]);
    const spies = renderPalette();

    await user.type(input(), "x");
    await screen.findByRole("option", { name: /First/ });

    await user.keyboard("{ArrowDown}"); // select the second result
    await user.keyboard("{Enter}");

    expect(spies.openNote).toHaveBeenCalledWith("r1");
    expect(spies.setPaletteOpen).toHaveBeenCalledWith(false);
    expect(spies.flyToNode).not.toHaveBeenCalled();
  });

  it("Alt+Enter reveals the selected note in the graph instead of opening it", async () => {
    const user = userEvent.setup();
    searchNotesRemote.mockResolvedValue([
      mkResult({ note_id: "r0", title: "First" }),
    ]);
    const spies = renderPalette();

    await user.type(input(), "x");
    await screen.findByRole("option", { name: /First/ });

    await user.keyboard("{Alt>}{Enter}{/Alt}");

    expect(spies.flyToNode).toHaveBeenCalledWith("r0");
    expect(spies.setPaletteOpen).toHaveBeenCalledWith(false);
    expect(spies.openNote).not.toHaveBeenCalled();
  });

  it("Escape closes the palette", async () => {
    const user = userEvent.setup();
    const spies = renderPalette();

    await user.type(input(), "{Escape}");

    expect(spies.setPaletteOpen).toHaveBeenCalledWith(false);
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppCtx, type AppContextValue } from "@/context/app-ctx";
import type { Capture, Note } from "@/data/types";
import { ThreadsView } from "./ThreadsView";

vi.mock("@/api/chat", async (orig) => ({
  ...(await orig<typeof import("@/api/chat")>()),
  listChatSessions: vi.fn(async () => ["2026-05-14"]),
  loadChatDay: vi.fn(async () => ({
    agent: "_council",
    messages: [
      {
        role: "user",
        content: "What changed?",
        timestamp: "2026-05-14T10:00:00Z",
        agent: "_council",
      },
      {
        role: "council",
        content: "Two notes were filed.",
        timestamp: "2026-05-14T10:00:05Z",
        agent: "_council",
      },
    ],
  })),
}));
vi.mock("@/api/changelog", async (orig) => ({
  ...(await orig<typeof import("@/api/changelog")>()),
  fetchChangelogFeed: vi.fn(async () => []),
}));

const noon = (date: string) => `${date}T12:00:00Z`;

function note(id: string, patch: Partial<Note>): Note {
  return {
    id,
    title: id,
    type: "topic",
    folder: "topics",
    filename: `${id}.md`,
    tags: [],
    body: "",
    links: [],
    history: [],
    created: noon("2026-05-16"),
    modified: noon("2026-05-16"),
    status: "active",
    source: "manual",
    ...patch,
  };
}

const NOTES: Note[] = [
  note("d16", {
    type: "daily",
    folder: "daily",
    filename: "2026-05-16.md",
    title: "2026-05-16",
    body: "## Summary\n\nA quiet day of filing.\n\n## Detail\n\nMore.",
    history: [
      { action: "created", by: "agent:scribe", at: noon("2026-05-16") },
    ],
  }),
  note("d15", {
    type: "daily",
    folder: "daily",
    title: "2026-05-15",
    created: noon("2026-05-15"),
  }),
  note("raft", { title: "Raft", links: ["d16"] }),
];
const CAPTURES = [
  {
    id: "cap1",
    title: "Standup — 2026-05-16",
    folder: "captures",
    body: "Recap: two reviews waiting.",
    receivedAt: noon("2026-05-16"),
    status: "pending",
    source: "agent:standup",
  },
] as Capture[];

function renderThreads(path = "/threads", notes = NOTES, captures = CAPTURES) {
  const ctx = {
    notes,
    notesLoaded: true,
    captures,
    communities: { slotOf: new Map(), communities: [], key: "" },
    changelog: [],
    council: [],
    noteById: (id: string) => notes.find((n) => n.id === id),
    reloadNoteBody: vi.fn(async () => {}),
    selectCapture: vi.fn(),
  } as unknown as AppContextValue;
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppCtx.Provider value={ctx}>
        <Routes>
          <Route path="/threads/:id?" element={<ThreadsView />} />
          <Route path="/inbox" element={<p>Inbox page</p>} />
        </Routes>
      </AppCtx.Provider>
    </MemoryRouter>,
  );
  return ctx;
}

describe("ThreadsView", () => {
  beforeEach(() => localStorage.clear());

  it("lists daily logs, then Standups, then Council chats", async () => {
    renderThreads();
    const list = screen.getByRole("navigation", { name: "Threads" });
    const headings = within(list).getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "Daily logs2",
      "Standups1",
      expect.stringMatching(/^Council chats/),
    ]);
    expect(
      await within(list).findByRole("link", { name: "Thu, May 14" }),
    ).toHaveAttribute("href", "/threads/council-2026-05-14");
    expect(
      within(list).getByRole("link", { name: "Sat, May 16 1 new note" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("opens the newest daily log with its byline, summary and sections", () => {
    renderThreads();
    expect(
      screen.getByRole("heading", { level: 1, name: "Saturday, May 16, 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByText("threads/daily/2026-05-16.md")).toBeInTheDocument();
    expect(
      screen.getByText(/Written by Scribe from that day's changelogs/),
    ).toBeInTheDocument();
    expect(screen.getByText("A quiet day of filing.")).toBeInTheDocument();
    const newNotes = screen.getByRole("region", { name: /New notes/ });
    expect(
      within(newNotes).getByRole("link", { name: /Raft/ }),
    ).toHaveAttribute("href", "/notes/topics/raft");
    expect(screen.getByRole("region", { name: /Flags/ })).toHaveTextContent(
      "Nothing was flagged.",
    );
    expect(screen.getByRole("link", { name: /Open in Notes/ })).toHaveAttribute(
      "href",
      "/notes/daily/2026-05-16",
    );
  });

  it("shows this week's actions and the vault stats", () => {
    renderThreads();
    const week = screen.getByRole("complementary", { name: "This week" });
    expect(
      within(week).getByRole("heading", { name: "Agent actions" }),
    ).toBeInTheDocument();
    expect(within(week).getAllByRole("listitem")).toHaveLength(7);
    const notes = within(week).getByText("Notes").nextElementSibling;
    expect(notes).toHaveTextContent("3");
  });

  it("reads a Standup and opens it in the Inbox", async () => {
    const user = userEvent.setup();
    const ctx = renderThreads("/threads/standup-cap1");
    expect(screen.getByText("Recap: two reviews waiting.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open in Inbox/ }));
    expect(ctx.selectCapture).toHaveBeenCalledWith("cap1");
    expect(screen.getByText("Inbox page")).toBeInTheDocument();
  });

  it("loads a saved Council chat", async () => {
    renderThreads("/threads/council-2026-05-14");
    expect(
      screen.getByText("agents/_council/chat/2026-05-14.md"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Two notes were filed."),
    ).toBeInTheDocument();
    expect(screen.getByText("What changed?")).toBeInTheDocument();
    expect(screen.getByText("Loom Council · 1 question")).toBeInTheDocument();
  });

  it("says when a thread doesn't exist", () => {
    renderThreads("/threads/2020-01-01");
    expect(screen.getByText("This thread isn't here")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Threads" }),
    ).toHaveAttribute("href", "/threads");
  });

  it("explains an empty vault", async () => {
    const chat = await import("@/api/chat");
    vi.mocked(chat.listChatSessions).mockResolvedValueOnce([]);
    renderThreads("/threads", [], []);
    expect(screen.getByText("No threads yet")).toBeInTheDocument();
    expect(
      screen.getByText("Scribe hasn't written a daily log yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Agent actions" }),
    ).toBeInTheDocument();
  });
});

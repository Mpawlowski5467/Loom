/*
MainShell coverage:
1. ErrorBoundary containment — a throw in one chrome region (Nav / Tree /
   view / Toasts) must be contained by its own boundary so the other regions
   keep rendering instead of white-screening the whole app.
2. File-tree visibility — the tree accompanies only the graph/board tabs and
   can be hidden there via the treeVisible flag / ⌘B shortcut.

Heavy children are stubbed; per test we swap one stub for a throwing component.
*/
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useApp } = vi.hoisted(() => ({ useApp: vi.fn() }));
vi.mock("../context/app-ctx", () => ({ useApp }));

// Stub the heavy children. Each is a vi.fn so individual tests can override the
// implementation (e.g. make Nav throw) without touching the others.
const Nav = vi.fn(() => <nav>nav-region</nav>);
const Tree = vi.fn(() => <aside>tree-region</aside>);
const GraphView = vi.fn(() => <div>graph-view</div>);
const Toasts = vi.fn(() => <div>toasts-region</div>);

vi.mock("./layout/Nav", () => ({ Nav: () => Nav() }));
vi.mock("./layout/Tree", () => ({ Tree: () => Tree() }));
vi.mock("../views/GraphView", () => ({ GraphView: () => GraphView() }));
vi.mock("../views/Toasts", () => ({ Toasts: () => Toasts() }));
vi.mock("../views/ThreadView", () => ({ ThreadView: () => <div>thread</div> }));
vi.mock("../views/InboxView", () => ({ InboxView: () => <div>inbox</div> }));
vi.mock("../views/BoardView", () => ({ BoardView: () => <div>board</div> }));
vi.mock("../views/SettingsView", () => ({
  SettingsView: () => <div>settings</div>,
}));
vi.mock("../views/NewNoteModal", () => ({ NewNoteModal: () => null }));
vi.mock("../views/Palette", () => ({ Palette: () => <div>palette</div> }));
vi.mock("../views/Splash", () => ({ Splash: () => null }));
vi.mock("./primitives/LoomRibbon", () => ({ LoomRibbon: () => null }));
vi.mock("./UnindexedBanner", () => ({ UnindexedBanner: () => null }));

import { MainShell } from "./MainShell";

function appState(over: Record<string, unknown> = {}) {
  return {
    tab: "graph",
    setTab: vi.fn(),
    paletteOpen: false,
    setPaletteOpen: vi.fn(),
    newNoteOpen: false,
    setNewNoteOpen: vi.fn(),
    newNoteTitle: null,
    setNewNoteTitle: vi.fn(),
    notes: [],
    appendNote: vi.fn(),
    openNote: vi.fn(),
    setEditing: vi.fn(),
    treeVisible: true,
    setTreeVisible: vi.fn(),
    config: {
      active_vault: "main",
      ui: { theme: "paper" },
      onboarding: { completed: true },
      default_provider: "openai",
      providers: { openai: { api_key_set: true } },
    },
    offline: false,
    unindexedCount: 0,
    pushToast: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  useApp.mockReset().mockReturnValue(appState());
  Nav.mockReset().mockImplementation(() => <nav>nav-region</nav>);
  Tree.mockReset().mockImplementation(() => <aside>tree-region</aside>);
  GraphView.mockReset().mockImplementation(() => <div>graph-view</div>);
  Toasts.mockReset().mockImplementation(() => <div>toasts-region</div>);
  // Keep the boundary's componentDidCatch console noise out of the test output.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Make the post-onboarding splash a no-op for these tests.
  sessionStorage.setItem("loom.splash.seen", "1");
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("MainShell ErrorBoundary coverage", () => {
  it("renders all chrome regions when nothing throws", () => {
    render(<MainShell />);
    expect(screen.getByText("nav-region")).toBeInTheDocument();
    expect(screen.getByText("tree-region")).toBeInTheDocument();
    expect(screen.getByText("graph-view")).toBeInTheDocument();
    expect(screen.getByText("toasts-region")).toBeInTheDocument();
  });

  it("contains a Nav crash without losing the tree or the view", () => {
    Nav.mockImplementation(() => {
      throw new Error("nav boom");
    });
    render(<MainShell />);

    // Nav fell back to the boundary message...
    expect(
      screen.getByText(/Something went wrong rendering the navigation bar/),
    ).toBeInTheDocument();
    // ...but the rest of the shell still rendered.
    expect(screen.getByText("tree-region")).toBeInTheDocument();
    expect(screen.getByText("graph-view")).toBeInTheDocument();
    expect(screen.getByText("toasts-region")).toBeInTheDocument();
  });

  it("contains a Tree crash without losing the central view", () => {
    Tree.mockImplementation(() => {
      throw new Error("tree boom");
    });
    render(<MainShell />);

    expect(
      screen.getByText(/Something went wrong rendering the file tree/),
    ).toBeInTheDocument();
    expect(screen.getByText("nav-region")).toBeInTheDocument();
    expect(screen.getByText("graph-view")).toBeInTheDocument();
  });

  it("contains a Toasts crash without losing the rest of the shell", () => {
    Toasts.mockImplementation(() => {
      throw new Error("toast boom");
    });
    render(<MainShell />);

    expect(
      screen.getByText(/Something went wrong rendering notifications/),
    ).toBeInTheDocument();
    expect(screen.getByText("nav-region")).toBeInTheDocument();
    expect(screen.getByText("graph-view")).toBeInTheDocument();
  });
});

describe("MainShell file-tree visibility", () => {
  it("renders the tree on the graph tab", () => {
    useApp.mockReturnValue(appState({ tab: "graph" }));
    render(<MainShell />);
    expect(screen.getByText("tree-region")).toBeInTheDocument();
  });

  it("renders the tree on the board tab", () => {
    useApp.mockReturnValue(appState({ tab: "board" }));
    render(<MainShell />);
    expect(screen.getByText("tree-region")).toBeInTheDocument();
    expect(screen.getByText("board")).toBeInTheDocument();
  });

  it("omits the tree on the thread tab (full-width view)", () => {
    useApp.mockReturnValue(appState({ tab: "thread" }));
    render(<MainShell />);
    expect(screen.queryByText("tree-region")).not.toBeInTheDocument();
    expect(screen.getByText("thread")).toBeInTheDocument();
  });

  it("omits the tree on the inbox tab (full-width view)", () => {
    useApp.mockReturnValue(appState({ tab: "inbox" }));
    render(<MainShell />);
    expect(screen.queryByText("tree-region")).not.toBeInTheDocument();
    expect(screen.getByText("inbox")).toBeInTheDocument();
  });

  it("omits the tree on the settings tab", () => {
    useApp.mockReturnValue(appState({ tab: "settings" }));
    render(<MainShell />);
    expect(screen.queryByText("tree-region")).not.toBeInTheDocument();
    expect(screen.getByText("settings")).toBeInTheDocument();
  });

  it("omits the tree on graph when treeVisible is false", () => {
    useApp.mockReturnValue(appState({ tab: "graph", treeVisible: false }));
    render(<MainShell />);
    expect(screen.queryByText("tree-region")).not.toBeInTheDocument();
    expect(screen.getByText("graph-view")).toBeInTheDocument();
  });

  it("Cmd/Ctrl+B toggles the tree on graph but is inert on thread", () => {
    const setTreeVisible = vi.fn();
    useApp.mockReturnValue(appState({ tab: "graph", setTreeVisible }));
    const { unmount } = render(<MainShell />);
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(setTreeVisible).toHaveBeenCalledWith(false);
    unmount();

    setTreeVisible.mockClear();
    useApp.mockReturnValue(appState({ tab: "thread", setTreeVisible }));
    render(<MainShell />);
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(setTreeVisible).not.toHaveBeenCalled();
  });
});

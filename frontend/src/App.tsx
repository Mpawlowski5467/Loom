import { useEffect, useRef } from "react";
import "./styles/variables.css";
import "./App.css";
import { CreateNoteModal } from "./components/CreateNoteModal/CreateNoteModal";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { FileTree } from "./components/FileTree/FileTree";
import { SearchDropdown } from "./components/SearchDropdown/SearchDropdown";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { ToastContainer } from "./components/Toast/Toast";
import { useApp } from "./lib/context/useApp";
import { BoardView } from "./views/BoardView/BoardView";
import { GraphView } from "./views/GraphView/GraphView";
import { InboxView } from "./views/InboxView/InboxView";

type View = "graph" | "board" | "inbox";

const TABS: { id: View; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "board", label: "Board" },
  { id: "inbox", label: "Inbox" },
];

function App() {
  const {
    activeView,
    setActiveView,
    activeNote,
    selectNote,
    closeSidebar,
    sidebarMode,
    setSidebarMode,
    showCreateModal,
    hideCreateModal,
    isCreateModalOpen,
    addToast,
  } = useApp();

  const searchRef = useRef<HTMLInputElement>(null);

  // -- Keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Escape → close sidebar
      if (e.key === "Escape") {
        if (isCreateModalOpen) {
          hideCreateModal();
        } else if (activeNote) {
          closeSidebar();
        }
        return;
      }

      // Cmd/Ctrl+K → focus search
      if (mod && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      // Cmd/Ctrl+N → create note
      if (mod && e.key === "n") {
        e.preventDefault();
        showCreateModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeNote, isCreateModalOpen, closeSidebar, hideCreateModal, showCreateModal]);

  return (
    <div className="app">
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="toolbar">
        <div className="toolbar-logo">
          <div className="toolbar-logo-icon" />
          <span className="toolbar-logo-text">LOOM</span>
        </div>

        <div className="toolbar-sep" />

        <div className="toolbar-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`toolbar-tab${activeView === tab.id ? " toolbar-tab--active" : ""}`}
              onClick={() => setActiveView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="toolbar-spacer" />

        <SearchDropdown onSelect={selectNote} inputRef={searchRef} />

        <div className="toolbar-sep" />

        <button className="toolbar-btn" title="Settings">
          &#9881;
        </button>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="app-body">
        <FileTree
          activeFile={activeNote}
          onFileSelect={selectNote}
          onCreateNote={showCreateModal}
        />

        <main
          className={`app-main${activeView === "graph" ? " app-main--flush" : ""}`}
        >
          <ErrorBoundary fallbackMessage="This view encountered an error">
            {activeView === "graph" && (
              <GraphView
                activeFile={activeNote}
                onFileSelect={selectNote}
              />
            )}
            {activeView === "board" && <BoardView />}
            {activeView === "inbox" && (
              <InboxView onSelectCapture={selectNote} />
            )}
          </ErrorBoundary>
        </main>

        <Sidebar
          noteId={activeNote}
          onClose={closeSidebar}
          onNavigate={selectNote}
          mode={sidebarMode}
          onModeChange={setSidebarMode}
          onToast={addToast}
        />
      </div>

      {/* ── Status bar ────────────────────────────────────────────── */}
      <div className="statusbar">
        <div className="statusbar-item">
          <span className="statusbar-dot" />
          <span>Ready</span>
        </div>
        <div className="statusbar-spacer" />
        <div className="statusbar-right">
          <span>{activeView.charAt(0).toUpperCase() + activeView.slice(1)}</span>
          {activeNote && (
            <>
              <span>|</span>
              <span>{activeNote}</span>
            </>
          )}
        </div>
      </div>

      {isCreateModalOpen && (
        <CreateNoteModal
          onCreated={(note) => {
            hideCreateModal();
            selectNote(note.id);
            addToast(`Note "${note.title}" created`);
          }}
          onClose={hideCreateModal}
        />
      )}

      <ToastContainer />
    </div>
  );
}

export default App;

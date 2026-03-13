import { useEffect, useRef } from "react";
import "./styles/variables.css";
import "./App.css";
import { CreateNoteModal } from "./components/CreateNoteModal/CreateNoteModal";
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
      <nav className="nav">
        <div className="nav-logo">
          <div className="nav-logo-icon" />
          <span className="nav-logo-text">LOOM</span>
        </div>

        <div className="nav-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab${activeView === tab.id ? " nav-tab--active" : ""}`}
              onClick={() => setActiveView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="nav-spacer" />

        <SearchDropdown onSelect={selectNote} inputRef={searchRef} />

        <button className="nav-settings" title="Settings">
          &#9881;
        </button>
      </nav>

      <div className="app-body">
        <FileTree
          activeFile={activeNote}
          onFileSelect={selectNote}
          onCreateNote={showCreateModal}
        />

        <main
          className={`app-main${activeView === "graph" ? " app-main--flush" : ""}`}
        >
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

import { useCallback, useState } from "react";
import "./styles/variables.css";
import "./App.css";
import { CreateNoteModal } from "./components/CreateNoteModal/CreateNoteModal";
import { FileTree } from "./components/FileTree/FileTree";
import { SearchDropdown } from "./components/SearchDropdown/SearchDropdown";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { GraphView } from "./views/GraphView/GraphView";

type View = "graph" | "board" | "inbox";

const TABS: { id: View; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "board", label: "Board" },
  { id: "inbox", label: "Inbox" },
];

function App() {
  const [activeView, setActiveView] = useState<View>("graph");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleSelectNote = useCallback((noteId: string) => {
    setActiveNoteId(noteId);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setActiveNoteId(null);
  }, []);

  const handleNavigate = useCallback((noteId: string) => {
    setActiveNoteId(noteId);
  }, []);

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

        <SearchDropdown onSelect={handleSelectNote} />

        <button className="nav-settings" title="Settings">
          &#9881;
        </button>
      </nav>

      <div className="app-body">
        <FileTree
          activeFile={activeNoteId}
          onFileSelect={handleSelectNote}
          onCreateNote={() => setShowCreateModal(true)}
        />

        <main
          className={`app-main${activeView === "graph" ? " app-main--flush" : ""}`}
        >
          {activeView === "graph" && (
            <GraphView
              activeFile={activeNoteId}
              onFileSelect={handleSelectNote}
            />
          )}
          {activeView === "board" && (
            <div className="view-placeholder">Board View</div>
          )}
          {activeView === "inbox" && (
            <div className="view-placeholder">Inbox View</div>
          )}
        </main>

        <Sidebar
          noteId={activeNoteId}
          onClose={handleCloseSidebar}
          onNavigate={handleNavigate}
        />
      </div>

      {showCreateModal && (
        <CreateNoteModal
          onCreated={(note) => {
            setShowCreateModal(false);
            setActiveNoteId(note.id);
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

export default App;

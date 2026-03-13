import { useState } from "react";
import "./styles/variables.css";
import "./App.css";
import { FileTree } from "./components/FileTree/FileTree";

type View = "graph" | "board" | "inbox";

const TABS: { id: View; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "board", label: "Board" },
  { id: "inbox", label: "Inbox" },
];

function App() {
  const [activeView, setActiveView] = useState<View>("graph");
  const [activeFile, setActiveFile] = useState<string | null>(null);

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

        <input
          className="nav-search"
          type="text"
          placeholder="Search vault..."
        />

        <button className="nav-settings" title="Settings">
          &#9881;
        </button>
      </nav>

      <div className="app-body">
        <FileTree activeFile={activeFile} onFileSelect={setActiveFile} />

        <main className="app-main">
          {activeView === "graph" && (
            <div className="view-placeholder">Graph View</div>
          )}
          {activeView === "board" && (
            <div className="view-placeholder">Board View</div>
          )}
          {activeView === "inbox" && (
            <div className="view-placeholder">Inbox View</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

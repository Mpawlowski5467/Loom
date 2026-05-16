import { AppProvider } from "./context/AppContext";
import { AppShell } from "./components/AppShell";

function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./styles/variables.css";
import styles from "./App.module.css";
import { CreateNoteModal } from "./components/CreateNoteModal/CreateNoteModal";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { FileTree } from "./components/FileTree/FileTree";
import { SearchDropdown } from "./components/SearchDropdown/SearchDropdown";
import { SettingsModal } from "./components/SettingsModal/SettingsModal";
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // -- Keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Escape → close modals/sidebar
      if (e.key === "Escape") {
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
        } else if (isCreateModalOpen) {
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
  }, [
    activeNote,
    isCreateModalOpen,
    isSettingsOpen,
    closeSidebar,
    hideCreateModal,
    showCreateModal,
  ]);

  return (
    <div className={styles.app}>
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLogo}>
          <div className={styles.toolbarLogoIcon} />
          <span className={styles.toolbarLogoText}>LOOM</span>
        </div>

        <div className={styles.toolbarSep} />

        <div className={styles.toolbarTabs}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.toolbarTab}${activeView === tab.id ? ` ${styles.toolbarTabActive}` : ""}`}
              onClick={() => setActiveView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.toolbarSpacer} />

        <SearchDropdown onSelect={selectNote} inputRef={searchRef} />

        <div className={styles.toolbarSep} />

        <button
          className={styles.toolbarBtn}
          title="Settings"
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings size={16} />
        </button>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className={styles.appBody}>
        <FileTree
          activeFile={activeNote}
          onFileSelect={selectNote}
          onCreateNote={showCreateModal}
        />

        <main
          className={`${styles.appMain}${activeView === "graph" ? ` ${styles.appMainFlush}` : ""}`}
        >
          <ErrorBoundary fallbackMessage="This view encountered an error">
            {activeView === "graph" && (
              <GraphView activeFile={activeNote} onFileSelect={selectNote} />
            )}
            {activeView === "board" && <BoardView />}
            {activeView === "inbox" && <InboxView onSelectCapture={selectNote} />}
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
      <div className={styles.statusbar}>
        <div className={styles.statusbarItem}>
          <span className={styles.statusbarDot} />
          <span>Ready</span>
        </div>
        <div className={styles.statusbarSpacer} />
        <div className={styles.statusbarRight}>
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

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}

      <ToastContainer />
    </div>
  );
}

export default App;

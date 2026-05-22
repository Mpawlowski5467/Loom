import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "../useTheme";
import { AppContext } from "./appContextValue";
import type { Toast } from "./appContextValue";

type View = "graph" | "board" | "inbox";
type SidebarMode = "view" | "edit";

let toastCounter = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [activeView, setActiveView] = useState<View>("graph");
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("view");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const selectNote = useCallback((noteId: string | null) => {
    setActiveNote(noteId);
    if (noteId) {
      setSidebarMode("view");
    }
  }, []);

  const closeSidebar = useCallback(() => {
    setActiveNote(null);
    setSidebarMode("view");
  }, []);

  const showCreateModal = useCallback(() => setCreateModalOpen(true), []);
  const hideCreateModal = useCallback(() => setCreateModalOpen(false), []);

  const addToast = useCallback((message: string, variant: Toast["variant"] = "success") => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      activeView,
      activeNote,
      sidebarMode,
      toasts,
      theme,
      setTheme,
      setActiveView,
      selectNote,
      closeSidebar,
      setSidebarMode,
      showCreateModal,
      hideCreateModal,
      isCreateModalOpen: createModalOpen,
      addToast,
      removeToast,
    }),
    [
      activeView,
      activeNote,
      sidebarMode,
      toasts,
      theme,
      setTheme,
      selectNote,
      closeSidebar,
      showCreateModal,
      hideCreateModal,
      createModalOpen,
      addToast,
      removeToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

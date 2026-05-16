import { createContext } from "react";
import type { Theme } from "../useTheme";

type View = "graph" | "board" | "inbox";
type SidebarMode = "view" | "edit";

export interface Toast {
  id: number;
  message: string;
  variant: "success" | "info" | "danger";
}

export interface AppContextValue {
  activeView: View;
  activeNote: string | null;
  sidebarMode: SidebarMode;
  toasts: Toast[];
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setActiveView: (view: View) => void;
  selectNote: (noteId: string | null) => void;
  closeSidebar: () => void;
  setSidebarMode: (mode: SidebarMode) => void;
  showCreateModal: () => void;
  hideCreateModal: () => void;
  isCreateModalOpen: boolean;
  addToast: (message: string, variant?: Toast["variant"]) => void;
  removeToast: (id: number) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);
